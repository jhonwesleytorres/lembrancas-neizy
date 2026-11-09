'use client';

import React, { useState, useRef } from 'react';
import {
  UploadCloud,
  CheckCircle2,
  Sparkles,
  X,
  Heart,
  Baby,
  Loader2,
  Database,
  Trash2,
  Upload,
} from 'lucide-react';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { collection, addDoc } from 'firebase/firestore';
import { db, storage, isFirebaseConfigured } from '@/lib/firebase';
import { processAndOptimizeMedia } from '@/lib/mediaOptimizer';
import { EventCategory, MediaItem } from '@/types/media';

const FIRESTORE_DOC_OVERHEAD_BYTES = 512;

interface PreparedMedia {
  tempId: string;
  originalName: string;
  customTitle: string;
  type: 'image' | 'video';
  format: string;
  fullBlob: Blob;
  thumbBlob: Blob;
  previewUrl: string;
  width: number;
  height: number;
  originalSize: number;
  optimizedSize: number;
  thumbSize: number;
  totalBytesToAdd: number;
}

interface StagedMedia {
  tempId: string;
  originalName: string;
  customTitle: string;
  type: 'image' | 'video';
  format: string;
  fullUrl: string;
  thumbUrl: string;
  width: number;
  height: number;
  originalSize: number;
  optimizedSize: number;
  thumbSize: number;
  totalBytesToAdd: number;
}

interface UploadModalProps {
  isOpen: boolean;
  currentUsedBytes?: number;
  onClose: () => void;
  onSuccess: (items: MediaItem[]) => void;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export default function UploadModal({
  isOpen,
  currentUsedBytes = 0,
  onClose,
  onSuccess,
}: UploadModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fluxo: 'select' -> 'preview' (Exibe tamanho total antes do upload) -> 'metadata' (Título + Categoria)
  const [step, setStep] = useState<'select' | 'preview' | 'metadata'>('select');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [preparedItems, setPreparedItems] = useState<PreparedMedia[]>([]);
  const [stagedItems, setStagedItems] = useState<StagedMedia[]>([]);
  const [selectedCategory, setSelectedCategory] =
    useState<EventCategory | null>(null);
  const [isSavingMetadata, setIsSavingMetadata] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  // 1. Escolher arquivos -> Otimizar localmente e exibir tamanho total antes de enviar ao Firebase
  const handleFileSelection = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setErrorMsg(null);
    setIsProcessing(true);
    setProgress(0);

    const prepared: PreparedMedia[] = [];

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileWeight = 100 / files.length;
        const baseProgress = i * fileWeight;

        setStatusText(
          `Otimizando e calculando tamanho (${i + 1}/${files.length}): "${file.name}"...`
        );

        const processed = await processAndOptimizeMedia(file, (p) => {
          setProgress(Math.round(baseProgress + (p * fileWeight) / 100));
        });

        const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const thumbSize = processed.thumbBlob.size;
        const totalBytesToAdd =
          processed.optimizedSize + thumbSize + FIRESTORE_DOC_OVERHEAD_BYTES;

        prepared.push({
          tempId: uniqueId,
          originalName: file.name,
          customTitle: file.name.replace(/\.[^/.]+$/, ''),
          type: processed.type,
          format: processed.format,
          fullBlob: processed.fullBlob,
          thumbBlob: processed.thumbBlob,
          previewUrl: URL.createObjectURL(processed.thumbBlob),
          width: processed.width,
          height: processed.height,
          originalSize: processed.originalSize,
          optimizedSize: processed.optimizedSize,
          thumbSize,
          totalBytesToAdd,
        });
      }

      setPreparedItems(prepared);
      setStep('preview');
    } catch (err) {
      console.error(err);
      setErrorMsg('Erro ao preparar os arquivos. Tente novamente.');
    } finally {
      setIsProcessing(false);
      setStatusText('');
    }
  };

  // 2. Confirmar e enviar arquivos otimizados para o Firebase Storage
  const handleConfirmAndUpload = async () => {
    if (preparedItems.length === 0) return;

    setErrorMsg(null);
    setIsProcessing(true);
    setProgress(0);

    const uploadedStaged: StagedMedia[] = [];

    try {
      for (let i = 0; i < preparedItems.length; i++) {
        const item = preparedItems[i];
        const fileWeight = 100 / preparedItems.length;
        const baseProgress = i * fileWeight;

        let fullUrl = '';
        let thumbUrl = '';

        if (isFirebaseConfigured) {
          setStatusText(
            `Enviando ${i + 1}/${preparedItems.length} (${formatBytes(item.totalBytesToAdd)}) para o Firebase Storage...`
          );

          const fullRef = ref(
            storage,
            `eventos/midias/${item.tempId}_full.${item.format}`
          );
          const thumbRef = ref(
            storage,
            `eventos/midias/${item.tempId}_thumb.webp`
          );

          await uploadBytesResumable(thumbRef, item.thumbBlob, {
            contentType: 'image/webp',
            cacheControl: 'public,max-age=31536000,immutable',
          });
          thumbUrl = await getDownloadURL(thumbRef);

          const uploadTask = uploadBytesResumable(fullRef, item.fullBlob, {
            contentType:
              item.type === 'video'
                ? `video/${item.format}`
                : `image/${item.format}`,
            cacheControl: 'public,max-age=31536000,immutable',
          });

          await new Promise<void>((resolve, reject) => {
            uploadTask.on(
              'state_changed',
              (snapshot) => {
                const transferPct =
                  (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                setProgress(
                  Math.round(baseProgress + (transferPct * fileWeight) / 100)
                );
              },
              (err) => reject(err),
              () => resolve()
            );
          });

          fullUrl = await getDownloadURL(fullRef);
        } else {
          fullUrl = URL.createObjectURL(item.fullBlob);
          thumbUrl = item.previewUrl;
          setProgress(Math.round(baseProgress + fileWeight));
        }

        uploadedStaged.push({
          tempId: item.tempId,
          originalName: item.originalName,
          customTitle: item.customTitle,
          type: item.type,
          format: item.format,
          fullUrl,
          thumbUrl,
          width: item.width,
          height: item.height,
          originalSize: item.originalSize,
          optimizedSize: item.optimizedSize,
          thumbSize: item.thumbSize,
          totalBytesToAdd: item.totalBytesToAdd,
        });
      }

      setStagedItems(uploadedStaged);
      setStep('metadata');
    } catch (err) {
      console.error(err);
      setErrorMsg('Erro durante o upload para o Firebase Storage.');
    } finally {
      setIsProcessing(false);
      setStatusText('');
    }
  };

  const handleRemovePrepared = (tempId: string) => {
    setPreparedItems((prev) => {
      const next = prev.filter((i) => i.tempId !== tempId);
      if (next.length === 0) setStep('select');
      return next;
    });
  };

  const handleTitleChange = (tempId: string, newTitle: string) => {
    setStagedItems((prev) =>
      prev.map((item) =>
        item.tempId === tempId ? { ...item, customTitle: newTitle } : item
      )
    );
  };

  const isMetadataValid =
    selectedCategory !== null &&
    stagedItems.length > 0 &&
    stagedItems.every((item) => item.customTitle.trim().length > 0);

  const handleSaveMetadata = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isMetadataValid || !selectedCategory) return;

    setIsSavingMetadata(true);
    setErrorMsg(null);

    try {
      const savedMediaItems: MediaItem[] = [];

      for (const item of stagedItems) {
        const payload: Omit<MediaItem, 'id'> = {
          title: item.customTitle.trim(),
          category: selectedCategory,
          type: item.type,
          fullUrl: item.fullUrl,
          thumbUrl: item.thumbUrl,
          width: item.width,
          height: item.height,
          originalSize: item.originalSize,
          optimizedSize: item.optimizedSize,
          thumbSize: item.thumbSize,
          format: item.format,
          isFavorite: false,
          createdAt: Date.now(),
        };

        if (isFirebaseConfigured) {
          const docRef = await addDoc(collection(db, 'midias'), payload);
          savedMediaItems.push({ id: docRef.id, ...payload });
        } else {
          savedMediaItems.push({ id: item.tempId, ...payload });
        }
      }

      onSuccess(savedMediaItems);
      resetAndClose();
    } catch (err) {
      console.error(err);
      setErrorMsg('Erro ao salvar os metadados no Firestore.');
    } finally {
      setIsSavingMetadata(false);
    }
  };

  const resetAndClose = () => {
    if (isProcessing || isSavingMetadata) return;
    setStep('select');
    setPreparedItems([]);
    setStagedItems([]);
    setSelectedCategory(null);
    setProgress(0);
    setErrorMsg(null);
    onClose();
  };

  const totalOriginalBatch = preparedItems.reduce(
    (acc, i) => acc + i.originalSize,
    0
  );
  const totalBytesToAddBatch = preparedItems.reduce(
    (acc, i) => acc + i.totalBytesToAdd,
    0
  );
  const savedBatchPct = Math.max(
    0,
    Math.round(
      ((totalOriginalBatch - totalBytesToAddBatch) /
        Math.max(1, totalOriginalBatch)) *
        100
    )
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4">
      <div className="w-full max-w-lg rounded-t-3xl sm:rounded-3xl bg-zinc-900 border border-zinc-800 text-zinc-100 shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        {/* Cabeçalho */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <div>
            <h2 className="text-lg font-semibold text-white">
              {step === 'select' && 'Enviar Fotos e Vídeos'}
              {step === 'preview' && 'Confirmar Espaço Antes do Upload'}
              {step === 'metadata' && 'Identificar e Categorizar'}
            </h2>
            <p className="text-xs text-zinc-400">
              {step === 'select' &&
                'Calcularemos o tamanho otimizado antes de enviar ao banco'}
              {step === 'preview' &&
                'Confira o tamanho total que será adicionado ao banco de dados'}
              {step === 'metadata' &&
                'Obrigatório: dê um título e escolha Casamento ou Revelação'}
            </p>
          </div>
          {step !== 'metadata' && !isProcessing && (
            <button
              onClick={resetAndClose}
              className="p-2 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
              aria-label="Fechar"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Corpo */}
        <div className="p-5 overflow-y-auto space-y-5">
          {errorMsg && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs">
              {errorMsg}
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*,.heic,.heif,.HEIC,.HEIF"
            multiple
            onChange={handleFileSelection}
            className="hidden"
            disabled={isProcessing}
          />

          {isProcessing ? (
            <div className="py-10 px-5 rounded-2xl bg-zinc-950 border border-zinc-800 space-y-4">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-amber-400 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {step === 'select'
                    ? 'Otimizando e calculando tamanho...'
                    : 'Enviando para o Firebase...'}
                </span>
                <span className="font-bold text-white">{progress}%</span>
              </div>

              <div className="w-full h-3 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-amber-500 to-rose-500 transition-all duration-300 rounded-full"
                  style={{ width: `${progress}%` }}
                />
              </div>

              <p className="text-xs text-zinc-400 text-center">{statusText}</p>
            </div>
          ) : step === 'select' ? (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-12 px-6 border-2 border-dashed border-zinc-700 hover:border-amber-400/70 rounded-2xl bg-zinc-950/60 flex flex-col items-center justify-center gap-3 transition group active:scale-[0.99]"
            >
              <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 group-hover:scale-110 transition">
                <UploadCloud className="w-7 h-7" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-white">
                  Toque para escolher fotos ou vídeos do celular
                </p>
                <p className="text-xs text-zinc-400 mt-1">
                  Mostraremos o tamanho exato antes de enviar ao banco
                </p>
              </div>
              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-400 bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20">
                <Sparkles className="w-3.5 h-3.5" />
                Redução inteligente de até 85% sem perda visual
              </span>
            </button>
          ) : step === 'preview' ? (
            <div className="space-y-4">
              {/* Resumo do Tamanho Total Antes do Upload */}
              <div className="p-4 rounded-2xl bg-zinc-950 border border-amber-500/30 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                    <Database className="w-4 h-4" />
                    Tamanho que será adicionado ao banco
                  </span>
                  {savedBatchPct > 0 && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                      -{savedBatchPct}% mais leve
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div className="p-2.5 rounded-xl bg-zinc-900/90 border border-zinc-800">
                    <span className="text-[10px] text-zinc-400 block">
                      Tamanho Original
                    </span>
                    <strong className="text-sm text-zinc-300 line-through">
                      {formatBytes(totalOriginalBatch)}
                    </strong>
                  </div>
                  <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30">
                    <span className="text-[10px] text-amber-300 block">
                      Total Otimizado a Enviar
                    </span>
                    <strong className="text-base font-extrabold text-white">
                      + {formatBytes(totalBytesToAddBatch)}
                    </strong>
                  </div>
                </div>

                <div className="text-[11px] text-zinc-400 flex items-center justify-between pt-1 border-t border-zinc-800/80">
                  <span>
                    Uso atual:{' '}
                    <strong className="text-zinc-200">
                      {formatBytes(currentUsedBytes)}
                    </strong>
                  </span>
                  <span>
                    Após envio:{' '}
                    <strong className="text-amber-300">
                      {formatBytes(currentUsedBytes + totalBytesToAddBatch)}
                    </strong>{' '}
                    / 1 GB
                  </span>
                </div>
              </div>

              {/* Lista de Arquivos Prontos */}
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {preparedItems.map((item) => (
                  <div
                    key={item.tempId}
                    className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-zinc-950 border border-zinc-800"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <img
                        src={item.previewUrl}
                        alt={item.originalName}
                        className="w-11 h-11 rounded-lg object-cover bg-zinc-900 flex-shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-white truncate">
                          {item.originalName}
                        </p>
                        <p className="text-[11px] text-zinc-400">
                          {formatBytes(item.originalSize)} →{' '}
                          <strong className="text-emerald-400">
                            + {formatBytes(item.totalBytesToAdd)}
                          </strong>{' '}
                          (.{item.format})
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemovePrepared(item.tempId)}
                      className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-zinc-900 transition"
                      title="Remover arquivo deste envio"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-3 rounded-2xl border border-zinc-700 text-xs font-semibold text-zinc-300 hover:text-white hover:bg-zinc-800 transition"
                >
                  Trocar Arquivos
                </button>
                <button
                  type="button"
                  onClick={handleConfirmAndUpload}
                  className="flex-1 py-3 px-5 rounded-2xl bg-gradient-to-r from-amber-500 to-rose-500 text-zinc-950 font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20 active:scale-[0.99] transition"
                >
                  <Upload className="w-4 h-4" />
                  <span>
                    Fazer Upload (+ {formatBytes(totalBytesToAddBatch)})
                  </span>
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSaveMetadata} className="space-y-5">
              {/* Seleção Obrigatória de Categoria */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  1. Selecione a Categoria do Evento (Obrigatório) *
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setSelectedCategory('Casamento')}
                    className={`flex items-center justify-center gap-2.5 p-3.5 rounded-2xl border text-sm font-semibold transition active:scale-95 ${
                      selectedCategory === 'Casamento'
                        ? 'bg-amber-500/20 border-amber-400 text-amber-300 shadow-lg shadow-amber-500/10'
                        : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                    }`}
                  >
                    <Heart className="w-4 h-4" />
                    Casamento
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedCategory('Revelação')}
                    className={`flex items-center justify-center gap-2.5 p-3.5 rounded-2xl border text-sm font-semibold transition active:scale-95 ${
                      selectedCategory === 'Revelação'
                        ? 'bg-sky-500/20 border-sky-400 text-sky-300 shadow-lg shadow-sky-500/10'
                        : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                    }`}
                  >
                    <Baby className="w-4 h-4" />
                    Revelação
                  </button>
                </div>
              </div>

              {/* Lista de Arquivos para Nomear */}
              <div className="space-y-3">
                <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  2. Dê um Nome / Título para as Mídias *
                </label>

                <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
                  {stagedItems.map((item) => (
                    <div
                      key={item.tempId}
                      className="flex items-center gap-3 p-3 rounded-2xl bg-zinc-950 border border-zinc-800"
                    >
                      <img
                        src={item.thumbUrl}
                        alt={item.customTitle}
                        className="w-16 h-16 rounded-xl object-cover flex-shrink-0 bg-zinc-900"
                      />

                      <div className="flex-1 min-w-0 space-y-1.5">
                        <input
                          type="text"
                          required
                          placeholder="Ex: Entrada dos Noivos, Chuva de Papel..."
                          value={item.customTitle}
                          onChange={(e) =>
                            handleTitleChange(item.tempId, e.target.value)
                          }
                          className="w-full px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-700 focus:border-amber-400 focus:outline-none text-sm text-white placeholder-zinc-500"
                        />

                        <div className="flex items-center gap-2 text-[11px] text-zinc-400">
                          <span className="uppercase font-medium text-emerald-400">
                            .{item.format}
                          </span>
                          <span>•</span>
                          <span>
                            Adicionado ao banco:{' '}
                            <strong className="text-zinc-200">
                              + {formatBytes(item.totalBytesToAdd)}
                            </strong>
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <button
                type="submit"
                disabled={!isMetadataValid || isSavingMetadata}
                className="w-full py-3.5 px-5 rounded-2xl bg-gradient-to-r from-amber-500 to-rose-500 text-zinc-950 font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-40 disabled:pointer-events-none shadow-lg shadow-amber-500/20 active:scale-[0.99] transition"
              >
                {isSavingMetadata ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Salvando na Galeria...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    Concluir e Publicar na Galeria
                  </>
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
