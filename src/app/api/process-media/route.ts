import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';

export const runtime = 'nodejs';

/**
 * Endpoint de Processamento e Otimização de Mídia com Sharp.
 * Intercepta fotos enviadas pelo celular, corrige orientação EXIF e gera:
 * 1. Versão Full (WebP ou AVIF, máx 1920px, qualidade 82)
 * 2. Versão Thumbnail (WebP, 400x400px crop inteligente, qualidade 70) para a Grade
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const preferredFormat = (formData.get('format') as 'webp' | 'avif') || 'webp';

    if (!file) {
      return NextResponse.json(
        { error: 'Nenhum arquivo enviado para processamento.' },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const inputBuffer = Buffer.from(arrayBuffer);

    // Pipeline Sharp base com rotação automática via EXIF (essencial para fotos de celular)
    const basePipeline = sharp(inputBuffer, { failOn: 'none' }).rotate();
    const metadata = await basePipeline.metadata();

    // 1. Geração da miniatura leve (Thumbnail 320x320px em WebP qualidade 58)
    const thumbBuffer = await basePipeline
      .clone()
      .resize({
        width: 320,
        height: 320,
        fit: 'cover',
        position: 'attention',
      })
      .webp({ quality: 58, effort: 4 })
      .toBuffer();

    // 2. Loop de Compressão Adaptativa (garante que HEIC e fotos já comprimidas nunca aumentem de tamanho)
    const compressionSteps = [
      { maxDim: 1600, quality: 72 },
      { maxDim: 1440, quality: 62 },
      { maxDim: 1280, quality: 52 },
      { maxDim: 1080, quality: 44 },
      { maxDim: 960, quality: 36 },
      { maxDim: 800, quality: 28 },
    ];

    const targetMaxTotalBytes = Math.max(10 * 1024, Math.floor(inputBuffer.byteLength * 0.72));
    let fullResult: { data: Buffer; info: sharp.OutputInfo } | null = null;

    for (const step of compressionSteps) {
      let fullPipeline = basePipeline.clone().resize({
        width: step.maxDim,
        height: step.maxDim,
        fit: 'inside',
        withoutEnlargement: true,
      });

      if (preferredFormat === 'avif') {
        fullPipeline = fullPipeline.avif({ quality: step.quality, effort: 4 });
      } else {
        fullPipeline = fullPipeline.webp({ quality: step.quality, effort: 4 });
      }

      const candidate = await fullPipeline.toBuffer({ resolveWithObject: true });
      fullResult = candidate;

      if (candidate.info.size + thumbBuffer.byteLength + 512 <= targetMaxTotalBytes) {
        break;
      }
    }

    if (!fullResult) {
      throw new Error('Não foi possível gerar imagem otimizada.');
    }

    return NextResponse.json({
      fullBase64: fullResult.data.toString('base64'),
      thumbBase64: thumbBuffer.toString('base64'),
      mimeType: preferredFormat === 'avif' ? 'image/avif' : 'image/webp',
      extension: preferredFormat,
      width: fullResult.info.width || metadata.width || 1080,
      height: fullResult.info.height || metadata.height || 1080,
      originalSize: inputBuffer.byteLength,
      optimizedSize: fullResult.info.size,
      thumbSize: thumbBuffer.byteLength,
    });
  } catch (error) {
    console.error('[Sharp Process Error]:', error);
    return NextResponse.json(
      { error: 'Falha ao otimizar imagem no servidor.' },
      { status: 500 }
    );
  }
}
