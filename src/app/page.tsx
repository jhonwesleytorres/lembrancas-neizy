'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Camera,
  Plus,
  Sparkles,
  Loader2,
  HardDrive,
  ChevronDown,
} from 'lucide-react';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import {
  db,
  isFirebaseConfigured,
  initFirebaseAnalytics,
} from '@/lib/firebase';
import { MediaItem } from '@/types/media';
import MediaGallery from '@/components/MediaGallery';
import UploadModal from '@/components/UploadModal';

const MAX_STORAGE_BYTES = 1 * 1024 * 1024 * 1024; // 1 GB
const FIRESTORE_DOC_OVERHEAD_BYTES = 512;

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function getItemTotalBytes(item: MediaItem): number {
  const full = Number(item.optimizedSize) || 0;
  const thumb = Number(item.thumbSize) || 20480;
  return full + thumb + FIRESTORE_DOC_OVERHEAD_BYTES;
}

export default function HomePage() {
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [showStorageDetails, setShowStorageDetails] = useState(false);

  // Inicializa Analytics e escuta a coleção 'midias' em tempo real no Firestore
  useEffect(() => {
    initFirebaseAnalytics().catch(() => {});

    if (!isFirebaseConfigured) {
      setIsLoading(false);
      return;
    }

    const q = query(collection(db, 'midias'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const docs: MediaItem[] = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...(doc.data() as Omit<MediaItem, 'id'>),
        }));
        setMediaItems(docs);
        setIsLoading(false);
      },
      (err) => {
        console.error('Erro ao escutar coleção midias no Firestore:', err);
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  const storageMetrics = useMemo(() => {
    const totalUsed = mediaItems.reduce(
      (acc, i) => acc + getItemTotalBytes(i),
      0
    );
    const totalOriginal = mediaItems.reduce(
      (acc, i) => acc + (Number(i.originalSize) || Number(i.optimizedSize) || 0),
      0
    );
    const savedBytes = Math.max(0, totalOriginal - totalUsed);

    const casamentoItems = mediaItems.filter((i) => i.category === 'Casamento');
    const revelacaoItems = mediaItems.filter((i) => i.category === 'Revelação');

    const casamentoBytes = casamentoItems.reduce(
      (acc, i) => acc + getItemTotalBytes(i),
      0
    );
    const revelacaoBytes = revelacaoItems.reduce(
      (acc, i) => acc + getItemTotalBytes(i),
      0
    );

    const casPct =
      totalUsed > 0
        ? Math.min(100, Math.max(0.5, (casamentoBytes / MAX_STORAGE_BYTES) * 100))
        : 0;
    const revPct =
      totalUsed > 0
        ? Math.min(100, Math.max(0.5, (revelacaoBytes / MAX_STORAGE_BYTES) * 100))
        : 0;

    return {
      totalUsed,
      totalOriginal,
      savedBytes,
      casamentoCount: casamentoItems.length,
      revelacaoCount: revelacaoItems.length,
      casamentoBytes,
      revelacaoBytes,
      casPct,
      revPct,
    };
  }, [mediaItems]);

  const handleUploadSuccess = (newItems: MediaItem[]) => {
    if (!isFirebaseConfigured) {
      setMediaItems((prev) => [...newItems, ...prev]);
    }
  };

  return (
    <main className="min-h-screen bg-zinc-950">
      {/* Header Mobile-First Fixo */}
      <header className="sticky top-0 z-40 h-[61px] bg-zinc-950/90 backdrop-blur-md border-b border-zinc-800/80 px-4 flex items-center justify-between">
        <div className="max-w-3xl w-full mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-rose-500 flex items-center justify-center text-zinc-950 shadow-md shadow-amber-500/20">
              <Camera className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight text-white leading-none">
                Lembranças
              </h1>
              <p className="text-[11px] text-zinc-400 mt-0.5 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-amber-400" />
                Casamento & Revelação
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsUploadOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-2xl bg-gradient-to-r from-amber-500 to-rose-500 text-zinc-950 font-bold text-xs shadow-lg shadow-amber-500/20 active:scale-95 transition"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            Enviar Mídia
          </button>
        </div>
      </header>

      {/* Painel de Armazenamento Usado */}
      <div className="bg-zinc-900/50 border-b border-zinc-800/70 px-4 py-2.5">
        <div className="max-w-3xl mx-auto">
          <button
            type="button"
            onClick={() => setShowStorageDetails((p) => !p)}
            className="w-full flex flex-col gap-1.5 text-left group"
          >
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 text-zinc-300 font-medium">
                <HardDrive className="w-3.5 h-3.5 text-amber-400" />
                <span>Armazenamento usado:</span>
                <strong className="text-white">
                  {formatBytes(storageMetrics.totalUsed)}
                </strong>
                <span className="text-zinc-500">de 1 GB</span>
              </div>

              <div className="flex items-center gap-2">
                <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Economia WebP: {formatBytes(storageMetrics.savedBytes)}
                </span>
                <span className="text-[11px] text-zinc-400 group-hover:text-white flex items-center gap-0.5">
                  Detalhes
                  <ChevronDown
                    className={`w-3.5 h-3.5 transition-transform ${
                      showStorageDetails ? 'rotate-180' : ''
                    }`}
                  />
                </span>
              </div>
            </div>

            <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden flex">
              <div
                className="h-full bg-amber-400 transition-all duration-300"
                style={{ width: `${storageMetrics.casPct}%` }}
                title="Casamento"
              />
              <div
                className="h-full bg-sky-400 transition-all duration-300"
                style={{ width: `${storageMetrics.revPct}%` }}
                title="Revelação"
              />
            </div>
          </button>

          {showStorageDetails && (
            <div className="pt-3 mt-2.5 border-t border-zinc-800/80 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="p-2.5 rounded-xl bg-zinc-950/80 border border-zinc-800/80">
                <span className="text-[10px] text-zinc-400 uppercase block">
                  Total no Banco
                </span>
                <strong className="text-sm text-white">
                  {formatBytes(storageMetrics.totalUsed)}
                </strong>
                <span className="text-[10px] text-zinc-500 block">
                  {mediaItems.length} mídia(s) salva(s)
                </span>
              </div>
              <div className="p-2.5 rounded-xl bg-zinc-950/80 border border-zinc-800/80">
                <span className="text-[10px] text-amber-400 uppercase block">
                  💍 Casamento
                </span>
                <strong className="text-sm text-white">
                  {formatBytes(storageMetrics.casamentoBytes)}
                </strong>
                <span className="text-[10px] text-zinc-500 block">
                  {storageMetrics.casamentoCount} mídia(s)
                </span>
              </div>
              <div className="p-2.5 rounded-xl bg-zinc-950/80 border border-zinc-800/80">
                <span className="text-[10px] text-sky-400 uppercase block">
                  🧸 Revelação
                </span>
                <strong className="text-sm text-white">
                  {formatBytes(storageMetrics.revelacaoBytes)}
                </strong>
                <span className="text-[10px] text-zinc-500 block">
                  {storageMetrics.revelacaoCount} mídia(s)
                </span>
              </div>
              <div className="p-2.5 rounded-xl bg-emerald-950/20 border border-emerald-500/20">
                <span className="text-[10px] text-emerald-400 uppercase block">
                  ✨ Espaço Economizado
                </span>
                <strong className="text-sm text-emerald-300">
                  {formatBytes(storageMetrics.savedBytes)}
                </strong>
                <span className="text-[10px] text-zinc-400 block">
                  Sem otimizar: {formatBytes(storageMetrics.totalOriginal)}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Galeria Principal com Busca, Abas e 3 Modos de Visualização */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-zinc-400">
          <Loader2 className="w-7 h-7 animate-spin text-amber-400" />
          <p className="text-xs">Carregando lembranças do evento...</p>
        </div>
      ) : (
        <MediaGallery items={mediaItems} />
      )}

      {/* Botão Flutuante (FAB) Mobile */}
      <button
        type="button"
        onClick={() => setIsUploadOpen(true)}
        aria-label="Adicionar fotos ou vídeos"
        className="sm:hidden fixed bottom-5 right-5 z-40 w-14 h-14 rounded-full bg-gradient-to-tr from-amber-500 to-rose-500 text-zinc-950 shadow-2xl shadow-amber-500/40 flex items-center justify-center active:scale-90 transition"
      >
        <Plus className="w-7 h-7 stroke-[2.5]" />
      </button>

      {/* Modal de Upload + Pré-visualização de Tamanho + Metadados Obrigatórios */}
      <UploadModal
        isOpen={isUploadOpen}
        currentUsedBytes={storageMetrics.totalUsed}
        onClose={() => setIsUploadOpen(false)}
        onSuccess={handleUploadSuccess}
      />
    </main>
  );
}
