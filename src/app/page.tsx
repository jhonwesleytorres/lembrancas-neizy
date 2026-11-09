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
  const [showInitialSplash, setShowInitialSplash] = useState(true);
  const [fadeSplash, setFadeSplash] = useState(false);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [showStorageDetails, setShowStorageDetails] = useState(false);

  // Inicializa Analytics e escuta a coleção 'midias' em tempo real no Firestore
  useEffect(() => {
    const startTime = Date.now();
    initFirebaseAnalytics().catch(() => {});

    const finishBoot = () => {
      setIsLoading(false);
      const elapsed = Date.now() - startTime;
      const delay = Math.max(0, 750 - elapsed);
      setTimeout(() => {
        setFadeSplash(true);
        setTimeout(() => setShowInitialSplash(false), 500);
      }, delay);
    };

    const fallbackTimer = setTimeout(finishBoot, 4000);

    if (!isFirebaseConfigured) {
      finishBoot();
      return () => clearTimeout(fallbackTimer);
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
        finishBoot();
      },
      (err) => {
        console.error('Erro ao escutar coleção midias no Firestore:', err);
        finishBoot();
      }
    );

    return () => {
      clearTimeout(fallbackTimer);
      unsubscribe();
    };
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
    <main className="min-h-screen w-full max-w-[100vw] overflow-x-hidden bg-zinc-950">
      {/* Tela de Load ao Abrir o App (Splash Screen) */}
      {showInitialSplash && (
        <div
          className={`fixed inset-0 z-[100] bg-zinc-950 flex flex-col items-center justify-center p-6 select-none transition-opacity duration-500 ${
            fadeSplash ? 'opacity-0 pointer-events-none' : 'opacity-100'
          }`}
        >
          <div className="relative flex flex-col items-center text-center max-w-xs w-full">
            <div className="absolute -top-6 w-36 h-36 bg-gradient-to-tr from-amber-500/20 to-rose-500/20 rounded-full blur-2xl pointer-events-none" />
            <div className="relative w-20 h-20 rounded-3xl bg-gradient-to-br from-amber-400 to-rose-500 flex items-center justify-center text-zinc-950 shadow-2xl shadow-amber-500/30 mb-5 animate-pulse">
              <Camera className="w-10 h-10 stroke-[2.2]" />
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight text-white">
              Lembranças
            </h1>
            <p className="text-xs font-semibold text-amber-400 mt-1 flex items-center justify-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>Casamento & Revelação</span>
            </p>
            <div className="w-48 h-1.5 bg-zinc-800/90 rounded-full overflow-hidden mt-7 relative">
              <div className="w-full h-full bg-gradient-to-r from-amber-400 via-rose-500 to-amber-400 rounded-full animate-loader-bar" />
            </div>
            <p className="text-xs text-zinc-400 mt-3 font-medium">
              Preparando suas lembranças...
            </p>
          </div>
        </div>
      )}

      {/* Header Mobile-First Fixo */}
      <header className="sticky top-0 z-40 h-[61px] w-full bg-zinc-950/90 backdrop-blur-md border-b border-zinc-800/80 px-3 sm:px-4 flex items-center justify-between">
        <div className="max-w-3xl w-full mx-auto flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-2 sm:gap-2.5 min-w-0 flex-shrink">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-gradient-to-br from-amber-400 to-rose-500 flex items-center justify-center text-zinc-950 shadow-md shadow-amber-500/20 flex-shrink-0">
              <Camera className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm sm:text-base font-bold tracking-tight text-white leading-none truncate">
                Lembranças
              </h1>
              <p className="text-[10px] sm:text-[11px] text-zinc-400 mt-0.5 flex items-center gap-1 truncate">
                <Sparkles className="w-3 h-3 text-amber-400 flex-shrink-0" />
                <span className="truncate">Casamento & Revelação</span>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsUploadOpen(true)}
            className="inline-flex items-center justify-center gap-1 sm:gap-1.5 px-2.5 py-2 sm:px-3.5 sm:py-2 rounded-xl sm:rounded-2xl bg-gradient-to-r from-amber-500 to-rose-500 text-zinc-950 font-bold text-xs shadow-lg shadow-amber-500/20 active:scale-95 transition flex-shrink-0"
          >
            <Plus className="w-4 h-4 stroke-[2.5] flex-shrink-0" />
            <span className="hidden sm:inline">Enviar Mídia</span>
            <span className="sm:hidden text-[11px]">Enviar</span>
          </button>
        </div>
      </header>

      {/* Painel de Armazenamento Usado */}
      <div className="w-full bg-zinc-900/50 border-b border-zinc-800/70 px-3 sm:px-4 py-2.5 overflow-hidden">
        <div className="max-w-3xl mx-auto">
          <button
            type="button"
            onClick={() => setShowStorageDetails((p) => !p)}
            className="w-full flex flex-col gap-1.5 text-left group"
          >
            <div className="flex items-center justify-between gap-2 text-xs min-w-0">
              <div className="flex items-center gap-1.5 text-zinc-300 font-medium min-w-0 truncate">
                <HardDrive className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                <span className="hidden sm:inline">Armazenamento usado:</span>
                <span className="sm:hidden">Espaço:</span>
                <strong className="text-white whitespace-nowrap">
                  {formatBytes(storageMetrics.totalUsed)}
                </strong>
                <span className="text-zinc-500 whitespace-nowrap">de 1 GB</span>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Economia WebP: {formatBytes(storageMetrics.savedBytes)}
                </span>
                <span className="text-[11px] text-zinc-400 group-hover:text-white flex items-center gap-0.5 whitespace-nowrap">
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
