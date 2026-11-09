export interface ProcessedMediaResult {
  fullBlob: Blob;
  thumbBlob: Blob;
  type: 'image' | 'video';
  format: string;
  width: number;
  height: number;
  originalSize: number;
  optimizedSize: number;
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const byteCharacters = atob(base64);
  const byteArrays: Uint8Array[] = [];

  for (let offset = 0; offset < byteCharacters.length; offset += 1024) {
    const slice = byteCharacters.slice(offset, offset + 1024);
    const byteNumbers = new Array(slice.length);
    for (let i = 0; i < slice.length; i++) {
      byteNumbers[i] = slice.charCodeAt(i);
    }
    byteArrays.push(new Uint8Array(byteNumbers));
  }

  return new Blob(byteArrays as BlobPart[], { type: mimeType });
}

/**
 * Processa fotos via API Route (/api/process-media com Sharp)
 * e possui fallback em Canvas WebP caso o arquivo exceda limites de rede.
 */
async function processImageFile(
  file: File,
  onProgress?: (pct: number) => void
): Promise<ProcessedMediaResult> {
  onProgress?.(10);

  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('format', 'webp');

    onProgress?.(35);
    const response = await fetch('/api/process-media', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error('Fallback para otimização local WebP');
    }

    const data = await response.json();
    onProgress?.(90);

    const fullBlob = base64ToBlob(data.fullBase64, data.mimeType);
    const thumbBlob = base64ToBlob(data.thumbBase64, 'image/webp');

    onProgress?.(100);
    return {
      fullBlob,
      thumbBlob,
      type: 'image',
      format: data.extension,
      width: data.width,
      height: data.height,
      originalSize: data.originalSize,
      optimizedSize: data.optimizedSize,
    };
  } catch {
    // Fallback Client-Side Canvas -> WebP caso offline
    return processImageClientFallback(file, onProgress);
  }
}

async function processImageClientFallback(
  file: File,
  onProgress?: (pct: number) => void
): Promise<ProcessedMediaResult> {
  const bitmap = await createImageBitmap(file);
  const srcW = bitmap.width;
  const srcH = bitmap.height;

  // 1. Gera versão Thumbnail 320x320 em WebP leve (~6 a 12 KB) para a Grade
  const thumbSize = 320;
  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = thumbSize;
  thumbCanvas.height = thumbSize;
  const thumbCtx = thumbCanvas.getContext('2d')!;
  const minSide = Math.min(srcW, srcH);
  const sx = (srcW - minSide) / 2;
  const sy = (srcH - minSide) / 2;
  thumbCtx.drawImage(bitmap, sx, sy, minSide, minSide, 0, 0, thumbSize, thumbSize);

  const thumbBlob = await new Promise<Blob>((resolve) =>
    thumbCanvas.toBlob((b) => resolve(b || file), 'image/webp', 0.58)
  );
  onProgress?.(40);

  // 2. Loop de Compressão Adaptativa em WebP para garantir redução real de tamanho (inclusive HEIC)
  const compressionSteps = [
    { maxDim: 1600, quality: 0.72 },
    { maxDim: 1440, quality: 0.62 },
    { maxDim: 1280, quality: 0.52 },
    { maxDim: 1080, quality: 0.44 },
    { maxDim: 960, quality: 0.36 },
    { maxDim: 800, quality: 0.28 },
    { maxDim: 640, quality: 0.22 },
  ];

  const targetMaxTotalBytes = Math.max(10 * 1024, Math.floor(file.size * 0.72));
  let fullBlob: Blob = file;
  let finalWidth = srcW;
  let finalHeight = srcH;

  for (let s = 0; s < compressionSteps.length; s++) {
    const { maxDim, quality } = compressionSteps[s];
    let width = srcW;
    let height = srcH;

    if (width > maxDim || height > maxDim) {
      const ratio = Math.min(maxDim / width, maxDim / height);
      width = Math.max(1, Math.round(width * ratio));
      height = Math.max(1, Math.round(height * ratio));
    }

    const fullCanvas = document.createElement('canvas');
    fullCanvas.width = width;
    fullCanvas.height = height;
    const fullCtx = fullCanvas.getContext('2d')!;
    fullCtx.drawImage(bitmap, 0, 0, width, height);

    const candidate = await new Promise<Blob | null>((resolve) =>
      fullCanvas.toBlob((b) => resolve(b), 'image/webp', quality)
    );
    if (!candidate) continue;

    fullBlob = candidate;
    finalWidth = width;
    finalHeight = height;

    if (fullBlob.size + thumbBlob.size + 512 <= targetMaxTotalBytes) {
      break;
    }
  }

  onProgress?.(100);

  return {
    fullBlob,
    thumbBlob,
    type: 'image',
    format: 'webp',
    width: finalWidth,
    height: finalHeight,
    originalSize: file.size,
    optimizedSize: fullBlob.size,
  };
}

/**
 * Processa e comprime vídeos do celular:
 * 1. Extrai um frame em WebP 320x320 leve (~8KB) para a Grade
 * 2. Re-codifica vídeos MP4/MOV via Canvas + MediaRecorder com controle de bitrate e resolução (720p/480p)
 *    garantindo redução real de tamanho (~40% a 85% menor que o original)
 */
async function processVideoFile(
  file: File,
  onProgress?: (pct: number) => void
): Promise<ProcessedMediaResult> {
  onProgress?.(10);
  const videoUrl = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.src = videoUrl;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';

  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error('Erro ao ler vídeo'));
  });

  const duration = Math.max(0.5, Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 1);
  const vw = video.videoWidth || 1080;
  const vh = video.videoHeight || 1920;

  // 1. Captura frame em 0.5s para gerar Thumbnail WebP leve (320x320)
  video.currentTime = Math.min(0.5, duration / 2);
  await new Promise<void>((resolve) => {
    const onSeek = () => {
      video.removeEventListener('seeked', onSeek);
      resolve();
    };
    video.addEventListener('seeked', onSeek);
    setTimeout(resolve, 500);
  });

  const thumbSize = 320;
  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = thumbSize;
  thumbCanvas.height = thumbSize;
  const thumbCtx = thumbCanvas.getContext('2d')!;
  const minSide = Math.min(vw, vh);
  const sx = (vw - minSide) / 2;
  const sy = (vh - minSide) / 2;
  thumbCtx.drawImage(video, sx, sy, minSide, minSide, 0, 0, thumbSize, thumbSize);

  const thumbBlob = await new Promise<Blob>((resolve) =>
    thumbCanvas.toBlob((b) => resolve(b || new Blob([], { type: 'image/webp' })), 'image/webp', 0.58)
  );

  // 2. Orçamento de bitrate para garantir que o vídeo final + thumbnail + metadados fique menor que o original
  const targetMaxTotalBytes = Math.max(32 * 1024, Math.floor(file.size * 0.58));
  const maxVideoBudgetBytes = Math.max(24 * 1024, targetMaxTotalBytes - thumbBlob.size - 512);
  const maxAllowedTotalBps = Math.floor((maxVideoBudgetBytes * 8) / duration);

  const audioBps = Math.min(64000, Math.max(24000, Math.floor(maxAllowedTotalBps * 0.15)));
  const videoBps = Math.min(1150000, Math.max(45000, maxAllowedTotalBps - audioBps));

  const maxDim = videoBps >= 650000 ? 1280 : videoBps >= 320000 ? 854 : 640;
  let targetW = vw;
  let targetH = vh;
  if (targetW > maxDim || targetH > maxDim) {
    const ratio = Math.min(maxDim / targetW, maxDim / targetH);
    targetW = Math.max(2, Math.round(targetW * ratio) & ~1);
    targetH = Math.max(2, Math.round(targetH * ratio) & ~1);
  }

  let optimizedVideoBlob: Blob | null = null;
  let format = file.type.includes('webm') ? 'webm' : 'mp4';

  const mimeCandidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
  ];
  const supportedMime =
    typeof MediaRecorder !== 'undefined'
      ? mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) || ''
      : '';

  if (supportedMime && duration <= 180) {
    try {
      const workCanvas = document.createElement('canvas');
      workCanvas.width = targetW;
      workCanvas.height = targetH;
      const ctx = workCanvas.getContext('2d')!;

      const canvasStream = workCanvas.captureStream(24);
      let audioCtx: AudioContext | null = null;
      const combinedTracks = [...canvasStream.getVideoTracks()];

      try {
        const AudioContextClass =
          window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (AudioContextClass) {
          audioCtx = new AudioContextClass();
          const sourceNode = audioCtx.createMediaElementSource(video);
          const destNode = audioCtx.createMediaStreamDestination();
          sourceNode.connect(destNode);
          video.muted = false;
          video.volume = 1.0;
          combinedTracks.push(...destNode.stream.getAudioTracks());
        }
      } catch {
        video.muted = true;
      }

      const combinedStream = new MediaStream(combinedTracks);
      const recorder = new MediaRecorder(combinedStream, {
        mimeType: supportedMime,
        videoBitsPerSecond: videoBps,
        audioBitsPerSecond: audioBps,
      });

      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunks.push(ev.data);
      };

      const recordingDone = new Promise<void>((resolve, reject) => {
        recorder.onstop = () => resolve();
        recorder.onerror = (e) => reject(e);
      });

      video.currentTime = 0;
      await new Promise<void>((resolve) => {
        const onSeek0 = () => {
          video.removeEventListener('seeked', onSeek0);
          resolve();
        };
        video.addEventListener('seeked', onSeek0);
        setTimeout(resolve, 400);
      });

      if (audioCtx && audioCtx.state === 'suspended') {
        await audioCtx.resume().catch(() => {});
      }

      ctx.drawImage(video, 0, 0, targetW, targetH);
      recorder.start(200);

      const drawTimer = setInterval(() => {
        if (!video.paused && !video.ended) {
          ctx.drawImage(video, 0, 0, targetW, targetH);
          const pct = Math.min(96, Math.max(15, Math.round((video.currentTime / duration) * 80) + 15));
          onProgress?.(pct);
        }
      }, 40);

      await video.play();
      await new Promise<void>((resolve) => {
        video.onended = () => resolve();
        setTimeout(resolve, duration * 1000 + 2500);
      });

      clearInterval(drawTimer);
      if (recorder.state !== 'inactive') recorder.stop();
      await recordingDone;

      combinedStream.getTracks().forEach((t) => t.stop());
      if (audioCtx) audioCtx.close().catch(() => {});

      const outType = supportedMime.includes('webm') ? 'video/webm' : 'video/mp4';
      const compressedCandidate = new Blob(chunks, { type: outType });

      if (compressedCandidate.size > 0 && compressedCandidate.size + thumbBlob.size + 512 < file.size) {
        optimizedVideoBlob = compressedCandidate;
        format = outType.includes('webm') ? 'webm' : 'mp4';
      }
    } catch (err) {
      console.warn('Fallback de compressão de vídeo:', err);
    }
  }

  URL.revokeObjectURL(videoUrl);

  if (!optimizedVideoBlob) {
    const isWebm = file.type.includes('webm');
    format = isWebm ? 'webm' : 'mp4';
    optimizedVideoBlob = new Blob([file], {
      type: isWebm ? 'video/webm' : 'video/mp4',
    });
  }

  onProgress?.(100);

  return {
    fullBlob: optimizedVideoBlob,
    thumbBlob,
    type: 'video',
    format,
    width: targetW,
    height: targetH,
    originalSize: file.size,
    optimizedSize: optimizedVideoBlob.size,
  };
}

export async function processAndOptimizeMedia(
  file: File,
  onProgress?: (pct: number) => void
): Promise<ProcessedMediaResult> {
  const fname = (file.name || '').toLowerCase();
  if (file.type.startsWith('video/') || /\.(mp4|mov|webm|m4v|avi|mkv)$/i.test(fname)) {
    return processVideoFile(file, onProgress);
  }
  return processImageFile(file, onProgress);
}
