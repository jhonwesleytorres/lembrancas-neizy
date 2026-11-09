'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Search,
  Grid3X3,
  PlaySquare,
  Heart,
  Baby,
  Play,
  Pause,
  X,
  ChevronLeft,
  ChevronRight,
  Download,
  Trash2,
  CheckSquare,
  Edit3,
  Film,
  Sparkles,
} from 'lucide-react';
import { doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { ref, deleteObject } from 'firebase/storage';
import { db, storage, isFirebaseConfigured } from '@/lib/firebase';
import { EventCategory, MediaItem, ViewMode } from '@/types/media';

interface MediaGalleryProps {
  items: MediaItem[];
}

export default function MediaGallery({ items }: MediaGalleryProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<
    'Todas' | EventCategory | 'Favoritos'
  >('Todas');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');

  // Modo Seleção e IDs Selecionados
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Lightbox HD e Navegação
  const [selectedHdItem, setSelectedHdItem] = useState<MediaItem | null>(null);

  // Modal de Edição de Nome
  const [editingItem, setEditingItem] = useState<MediaItem | null>(null);
  const [newTitleInput, setNewTitleInput] = useState('');

  // Modal de Confirmação de Exclusão
  const [itemsPendingDelete, setItemsPendingDelete] = useState<MediaItem[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);

  // Slideshow
  const [slideIndex, setSlideIndex] = useState(0);
  const [isSlideshowPlaying, setIsSlideshowPlaying] = useState(true);

  // LocalStorage para Favoritos
  const [localFavs, setLocalFavs] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      return new Set(JSON.parse(localStorage.getItem('lembrancas_favs') || '[]'));
    } catch {
      return new Set();
    }
  });

  const isItemFavorite = useCallback(
    (item: MediaItem) => Boolean(item.isFavorite || localFavs.has(item.id)),
    [localFavs]
  );

  // Alternar Favorito
  const handleToggleFavorite = async (item: MediaItem, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const nextStatus = !isItemFavorite(item);

    setLocalFavs((prev) => {
      const copy = new Set(prev);
      if (nextStatus) copy.add(item.id);
      else copy.delete(item.id);
      localStorage.setItem('lembrancas_favs', JSON.stringify(Array.from(copy)));
      return copy;
    });

    if (isFirebaseConfigured) {
      try {
        await updateDoc(doc(db, 'midias', item.id), { isFavorite: nextStatus });
      } catch (err) {
        console.warn('Erro ao atualizar favorito no Firestore:', err);
      }
    }
  };

  // Filtro por Nome, Categoria e Favoritos
  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
      let matchesCategory = false;
      if (activeCategory === 'Todas') matchesCategory = true;
      else if (activeCategory === 'Favoritos') matchesCategory = isItemFavorite(item);
      else matchesCategory = item.category === activeCategory;

      const matchesQuery = !q || item.title.toLowerCase().includes(q);
      return matchesCategory && matchesQuery;
    });
  }, [items, searchQuery, activeCategory, isItemFavorite]);

  // Contadores
  const totalCount = items.length;
  const casamentoCount = items.filter((i) => i.category === 'Casamento').length;
  const revelacaoCount = items.filter((i) => i.category === 'Revelação').length;
  const favoritosCount = items.filter((i) => isItemFavorite(i)).length;

  // Navegação no Lightbox
  const navigateLightbox = useCallback(
    (direction: -1 | 1) => {
      if (!selectedHdItem || filteredItems.length <= 1) return;
      const currentIndex = filteredItems.findIndex((i) => i.id === selectedHdItem.id);
      if (currentIndex === -1) return;

      let nextIndex = currentIndex + direction;
      if (nextIndex < 0) nextIndex = filteredItems.length - 1;
      else if (nextIndex >= filteredItems.length) nextIndex = 0;

      setSelectedHdItem(filteredItems[nextIndex]);
    },
    [selectedHdItem, filteredItems]
  );

  // Teclado para o Lightbox
  useEffect(() => {
    if (!selectedHdItem) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') navigateLightbox(-1);
      else if (e.key === 'ArrowRight') navigateLightbox(1);
      else if (e.key === 'Escape') setSelectedHdItem(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedHdItem, navigateLightbox]);

  // Download Individual
  const triggerDownload = async (item: MediaItem) => {
    const ext = item.format || (item.type === 'video' ? 'mp4' : 'webp');
    const cleanTitle = (item.title || 'lembranca').replace(/[^a-zA-Z0-9_-]/g, '_');
    try {
      const res = await fetch(item.fullUrl);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${cleanTitle}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      const a = document.createElement('a');
      a.href = item.fullUrl;
      a.target = '_blank';
      a.download = `${cleanTitle}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  // Baixar Selecionados
  const handleDownloadSelected = async () => {
    const toDownload = items.filter((i) => selectedIds.has(i.id));
    if (toDownload.length === 0) return;

    for (let i = 0; i < toDownload.length; i++) {
      await triggerDownload(toDownload[i]);
      if (toDownload.length > 1) {
        await new Promise((r) => setTimeout(r, 600));
      }
    }
  };

  // Apagar Selecionados / Itens Confirmados
  const handleConfirmDelete = async () => {
    if (itemsPendingDelete.length === 0) return;
    setIsDeleting(true);

    for (const item of itemsPendingDelete) {
      if (isFirebaseConfigured) {
        try {
          await deleteDoc(doc(db, 'midias', item.id));
          if (item.thumbUrl) {
            try {
              await deleteObject(ref(storage, item.thumbUrl));
            } catch (_) {}
          }
          if (item.fullUrl) {
            try {
              await deleteObject(ref(storage, item.fullUrl));
            } catch (_) {}
          }
        } catch (err) {
          console.error('Erro ao deletar do Firebase:', err);
        }
      }

      setLocalFavs((prev) => {
        const copy = new Set(prev);
        copy.delete(item.id);
        return copy;
      });

      setSelectedIds((prev) => {
        const copy = new Set(prev);
        copy.delete(item.id);
        return copy;
      });
    }

    setIsDeleting(false);
    setItemsPendingDelete([]);

    if (selectedHdItem && itemsPendingDelete.some((i) => i.id === selectedHdItem.id)) {
      setSelectedHdItem(null);
    }

    if (selectedIds.size === 0) {
      setIsSelectionMode(false);
    }
  };

  // Alternar Seleção de um Item
  const toggleSelectItem = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Salvar Novo Nome
  const handleSaveTitle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem || !newTitleInput.trim()) return;

    const trimmed = newTitleInput.trim();
    if (isFirebaseConfigured) {
      try {
        await updateDoc(doc(db, 'midias', editingItem.id), { title: trimmed });
      } catch (err) {
        console.error('Erro ao editar nome no Firestore:', err);
      }
    }

    if (selectedHdItem && selectedHdItem.id === editingItem.id) {
      setSelectedHdItem({ ...selectedHdItem, title: trimmed });
    }
    setEditingItem(null);
  };

  // Navegação do Slideshow
  const nextSlide = useCallback(() => {
    if (filteredItems.length === 0) return;
    setSlideIndex((prev) => (prev + 1) % filteredItems.length);
  }, [filteredItems.length]);

  const prevSlide = useCallback(() => {
    if (filteredItems.length === 0) return;
    setSlideIndex(
      (prev) => (prev - 1 + filteredItems.length) % filteredItems.length
    );
  }, [filteredItems.length]);

  useEffect(() => {
    if (viewMode !== 'slideshow' || !isSlideshowPlaying || filteredItems.length === 0) return;
    const timer = setInterval(() => nextSlide(), 4500);
    return () => clearInterval(timer);
  }, [viewMode, isSlideshowPlaying, filteredItems.length, nextSlide]);

  return (
    <div className="space-y-4 pb-24">
      {/* Barra Fixa de Ferramentas */}
      <div className="sticky top-[61px] z-30 bg-zinc-950/90 backdrop-blur-md border-b border-zinc-800/80 px-4 py-3 space-y-3">
        <div className="max-w-3xl mx-auto space-y-3">
          {/* Linha 1: Busca + Botão Modo Seleção + Alternador de Visualização */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar por nome ou momento..."
                className="w-full pl-9 pr-8 py-2.5 rounded-2xl bg-zinc-900 border border-zinc-800 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-amber-400/70 transition"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white p-1"
                  aria-label="Limpar busca"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Botão Modo Seleção */}
            <button
              type="button"
              onClick={() => {
                setIsSelectionMode((p) => !p);
                if (isSelectionMode) setSelectedIds(new Set());
              }}
              className={`p-2.5 rounded-2xl text-xs font-semibold flex items-center gap-1.5 transition ${
                isSelectionMode
                  ? 'bg-amber-500 text-zinc-950 shadow-md font-bold'
                  : 'bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white hover:border-zinc-700'
              }`}
              title="Modo Seleção"
            >
              <CheckSquare className="w-4 h-4" />
              <span className="hidden sm:inline">
                {isSelectionMode ? 'Concluir' : 'Selecionar'}
              </span>
            </button>

            {/* Alternador de Visualização */}
            <div className="flex items-center bg-zinc-900 p-1 rounded-2xl border border-zinc-800" role="group">
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                title="Visualização em Grade"
                className={`p-2 rounded-xl text-xs font-medium flex items-center gap-1 transition ${
                  viewMode === 'grid'
                    ? 'bg-amber-500 text-zinc-950 shadow'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Grid3X3 className="w-4 h-4" />
                <span className="hidden sm:inline">Grade</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setSlideIndex(0);
                  setIsSlideshowPlaying(true);
                  setViewMode('slideshow');
                }}
                title="Apresentação de Slides"
                className={`p-2 rounded-xl text-xs font-medium flex items-center gap-1 transition ${
                  viewMode === 'slideshow'
                    ? 'bg-amber-500 text-zinc-950 shadow'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <PlaySquare className="w-4 h-4" />
                <span className="hidden sm:inline">Slides</span>
              </button>
            </div>
          </div>

          {/* Linha 2: Abas Rápidas (Todas, Casamento, Revelação, Favoritos) */}
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={() => setActiveCategory('Todas')}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold transition flex-shrink-0 ${
                activeCategory === 'Todas'
                  ? 'bg-white text-zinc-950'
                  : 'bg-zinc-900 text-zinc-400 border border-zinc-800 hover:text-white'
              }`}
            >
              Todas ({totalCount})
            </button>

            <button
              type="button"
              onClick={() => setActiveCategory('Casamento')}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 transition flex-shrink-0 ${
                activeCategory === 'Casamento'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-400'
                  : 'bg-zinc-900 text-zinc-400 border border-zinc-800 hover:text-white'
              }`}
            >
              💍 Casamento ({casamentoCount})
            </button>

            <button
              type="button"
              onClick={() => setActiveCategory('Revelação')}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 transition flex-shrink-0 ${
                activeCategory === 'Revelação'
                  ? 'bg-sky-500/20 text-sky-300 border border-sky-400'
                  : 'bg-zinc-900 text-zinc-400 border border-zinc-800 hover:text-white'
              }`}
            >
              🧸 Revelação ({revelacaoCount})
            </button>

            <button
              type="button"
              onClick={() => setActiveCategory('Favoritos')}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 transition flex-shrink-0 ${
                activeCategory === 'Favoritos'
                  ? 'bg-rose-500/20 text-rose-300 border border-rose-400'
                  : 'bg-zinc-900 text-zinc-400 border border-zinc-800 hover:text-white'
              }`}
            >
              <Heart className="w-3.5 h-3.5 fill-rose-500 text-rose-500" />
              Favoritos ({favoritosCount})
            </button>
          </div>
        </div>
      </div>

      {/* Barra Flutuante de Ações do Modo Seleção (Baixar e Apagar) */}
      {isSelectionMode && (
        <aside className="fixed bottom-6 inset-x-3 max-w-xl mx-auto z-40 bg-zinc-900/95 backdrop-blur-md border border-zinc-700 rounded-2xl shadow-2xl p-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="px-2.5 py-1 rounded-xl bg-amber-500/20 text-amber-300 font-bold text-xs border border-amber-500/30 whitespace-nowrap">
              {selectedIds.size} sel.
            </span>
            <button
              type="button"
              onClick={() => {
                if (selectedIds.size === filteredItems.length) setSelectedIds(new Set());
                else setSelectedIds(new Set(filteredItems.map((i) => i.id)));
              }}
              className="text-xs text-zinc-300 hover:text-white underline underline-offset-2 whitespace-nowrap truncate"
            >
              {selectedIds.size === filteredItems.length ? 'Desmarcar' : 'Todos'}
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Baixar Selecionados */}
            <button
              type="button"
              onClick={handleDownloadSelected}
              disabled={selectedIds.size === 0}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-rose-500 text-zinc-950 font-bold text-xs shadow-md disabled:opacity-40 disabled:pointer-events-none active:scale-95 transition"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Baixar</span>
            </button>

            {/* APAGAR SELECIONADOS */}
            <button
              type="button"
              onClick={() => {
                const toDelete = items.filter((i) => selectedIds.has(i.id));
                if (toDelete.length > 0) setItemsPendingDelete(toDelete);
              }}
              disabled={selectedIds.size === 0}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs shadow-md shadow-red-600/30 disabled:opacity-40 disabled:pointer-events-none active:scale-95 transition"
              title="Apagar Selecionados"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Apagar</span>
            </button>

            {/* Cancelar Seleção */}
            <button
              type="button"
              onClick={() => {
                setIsSelectionMode(false);
                setSelectedIds(new Set());
              }}
              className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800"
              title="Cancelar Seleção"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </aside>
      )}

      {/* Modal de Confirmação de Exclusão */}
      {itemsPendingDelete.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-3xl bg-zinc-900 border border-zinc-800 p-6 space-y-4 shadow-2xl text-center">
            <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-center justify-center mx-auto">
              <Trash2 className="w-6 h-6" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-base font-bold text-white">
                {itemsPendingDelete.length === 1
                  ? 'Apagar esta Lembrança?'
                  : `Apagar ${itemsPendingDelete.length} Lembranças?`}
              </h3>
              <p className="text-xs text-zinc-400">
                {itemsPendingDelete.length === 1
                  ? `Tem certeza que deseja apagar "${itemsPendingDelete[0].title}"? Esta ação não pode ser desfeita.`
                  : `Tem certeza que deseja apagar permanentemente estas ${itemsPendingDelete.length} mídias? Esta ação não pode ser desfeita.`}
              </p>
            </div>
            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setItemsPendingDelete([])}
                className="flex-1 py-2.5 rounded-xl border border-zinc-700 text-xs font-semibold text-zinc-300 hover:text-white hover:bg-zinc-800 transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleConfirmDelete}
                className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs shadow-lg shadow-red-600/30 active:scale-95 transition"
              >
                {isDeleting ? 'Apagando...' : 'Sim, Apagar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Estado Vazio */}
      {filteredItems.length === 0 && (
        <div className="max-w-md mx-auto text-center py-16 px-4">
          <div className="w-14 h-14 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto mb-3 text-zinc-500">
            <Sparkles className="w-6 h-6" />
          </div>
          <h3 className="text-base font-semibold text-zinc-200">
            Nenhuma lembrança encontrada
          </h3>
          <p className="text-xs text-zinc-400 mt-1">
            Tente ajustar o termo de busca ou alternar entre as abas.
          </p>
        </div>
      )}

      {/* MODO: GRADE */}
      {viewMode === 'grid' && filteredItems.length > 0 && (
        <div className="max-w-3xl mx-auto px-1 sm:px-4">
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-1 sm:gap-2">
            {filteredItems.map((item) => {
              const isSelected = selectedIds.has(item.id);
              const isFav = isItemFavorite(item);

              return (
                <div
                  key={item.id}
                  onClick={() => {
                    if (isSelectionMode) toggleSelectItem(item.id);
                    else setSelectedHdItem(item);
                  }}
                  className={`group relative aspect-square bg-zinc-900 overflow-hidden sm:rounded-xl focus:outline-none cursor-pointer ${
                    isSelected ? 'ring-4 ring-amber-400 ring-offset-2 ring-offset-zinc-950 scale-[0.98]' : ''
                  }`}
                >
                  <img
                    src={item.thumbUrl}
                    alt={item.title}
                    loading="lazy"
                    decoding="async"
                    className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                  />

                  {/* Indicador do Modo Seleção */}
                  {isSelectionMode && (
                    <div
                      className={`absolute top-2 left-2 z-20 w-6 h-6 rounded-full border-2 ${
                        isSelected
                          ? 'bg-amber-400 border-amber-400 text-zinc-950 font-bold'
                          : 'bg-black/50 border-white/80 text-transparent'
                      } flex items-center justify-center text-xs shadow-lg transition`}
                    >
                      ✓
                    </div>
                  )}

                  {/* Botão de Favorito no Canto Superior Direito */}
                  <button
                    type="button"
                    onClick={(e) => handleToggleFavorite(item, e)}
                    className={`absolute top-1.5 right-1.5 z-20 w-7 h-7 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center transition active:scale-90 ${
                      isFav ? 'text-rose-500' : 'text-white/70 hover:text-white'
                    }`}
                    title="Favoritar"
                  >
                    <Heart className={`w-4 h-4 ${isFav ? 'fill-rose-500' : ''}`} />
                  </button>

                  {/* Indicador de Vídeo */}
                  {item.type === 'video' && (
                    <span className="absolute bottom-6 right-2 w-6 h-6 rounded-full bg-black/70 flex items-center justify-center text-white">
                      <Film className="w-3.5 h-3.5" />
                    </span>
                  )}

                  {/* Título na Base */}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-1.5 text-left">
                    <p className="text-[11px] font-medium text-white truncate">
                      {item.title}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* LIGHTBOX DE ALTA RESOLUÇÃO COM AVANÇAR, RETROCEDER, FAVORITO, BAIXAR E APAGAR */}
      {selectedHdItem && (
        <div className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md flex flex-col justify-between p-3 sm:p-4 select-none">
          {/* Cabeçalho do Lightbox */}
          <div className="flex items-center justify-between text-white max-w-4xl w-full mx-auto z-20">
            <div className="flex-1 min-w-0 pr-3">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold truncate">
                  {selectedHdItem.title}
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setEditingItem(selectedHdItem);
                    setNewTitleInput(selectedHdItem.title);
                  }}
                  className="p-1 text-zinc-400 hover:text-amber-400"
                  title="Editar nome"
                >
                  <Edit3 className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center gap-2 text-xs text-zinc-400 mt-0.5">
                <span>{selectedHdItem.category}</span>
                <span>•</span>
                <span className="text-amber-400 font-medium">
                  {filteredItems.findIndex((i) => i.id === selectedHdItem.id) + 1} de {filteredItems.length}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              {/* Favoritar */}
              <button
                type="button"
                onClick={() => handleToggleFavorite(selectedHdItem)}
                className={`p-2.5 rounded-full transition ${
                  isItemFavorite(selectedHdItem)
                    ? 'bg-rose-500/20 text-rose-500 border border-rose-500/30'
                    : 'bg-zinc-800/80 text-zinc-300 hover:bg-zinc-700'
                }`}
                title="Favoritar"
              >
                <Heart
                  className={`w-5 h-5 ${
                    isItemFavorite(selectedHdItem) ? 'fill-rose-500' : ''
                  }`}
                />
              </button>

              {/* Baixar */}
              <button
                type="button"
                onClick={() => triggerDownload(selectedHdItem)}
                className="p-2.5 rounded-full bg-zinc-800/80 text-zinc-200 hover:text-white hover:bg-zinc-700 transition"
                title="Baixar mídia"
              >
                <Download className="w-5 h-5" />
              </button>

              {/* Apagar */}
              <button
                type="button"
                onClick={() => setItemsPendingDelete([selectedHdItem])}
                className="p-2.5 rounded-full bg-zinc-800/80 text-zinc-300 hover:bg-red-500/20 hover:text-red-400 transition"
                title="Apagar esta lembrança"
              >
                <Trash2 className="w-5 h-5" />
              </button>

              {/* Fechar */}
              <button
                type="button"
                onClick={() => setSelectedHdItem(null)}
                className="p-2.5 rounded-full bg-zinc-800/80 text-white hover:bg-zinc-700 transition"
                aria-label="Fechar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Centro: Mídia + Botões Flutuantes de Retroceder e Avançar */}
          <div className="relative flex-1 flex items-center justify-center overflow-hidden my-2">
            <button
              type="button"
              onClick={() => navigateLightbox(-1)}
              className="absolute left-2 sm:left-4 z-30 w-11 h-11 rounded-full bg-black/60 hover:bg-black/85 backdrop-blur-md text-white border border-white/10 flex items-center justify-center transition active:scale-95 shadow-xl"
              title="Mídia Anterior (Seta Esquerda)"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>

            {selectedHdItem.type === 'video' ? (
              <video
                key={selectedHdItem.id}
                src={selectedHdItem.fullUrl}
                poster={selectedHdItem.thumbUrl}
                controls
                autoPlay
                playsInline
                className="max-h-[80vh] max-w-full object-contain rounded-xl"
              />
            ) : (
              <img
                key={selectedHdItem.id}
                src={selectedHdItem.fullUrl}
                alt={selectedHdItem.title}
                loading="lazy"
                className="max-h-[80vh] max-w-full object-contain rounded-xl shadow-2xl"
              />
            )}

            <button
              type="button"
              onClick={() => navigateLightbox(1)}
              className="absolute right-2 sm:right-4 z-30 w-11 h-11 rounded-full bg-black/60 hover:bg-black/85 backdrop-blur-md text-white border border-white/10 flex items-center justify-center transition active:scale-95 shadow-xl"
              title="Próxima Mídia (Seta Direita)"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          </div>
        </div>
      )}

      {/* MODAL DE EDIÇÃO DE NOME */}
      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-3xl bg-zinc-900 border border-zinc-800 p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-white flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-amber-400" />
                Editar Nome da Lembrança
              </h3>
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveTitle} className="space-y-4">
              <input
                type="text"
                required
                value={newTitleInput}
                onChange={(e) => setNewTitleInput(e.target.value)}
                placeholder="Ex: Entrada dos Noivos, Bolo, etc."
                className="w-full px-3.5 py-2.5 rounded-2xl bg-zinc-950 border border-zinc-700 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-amber-400"
                autoFocus
              />

              <div className="flex items-center gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-rose-500 text-zinc-950 font-bold text-xs shadow-md active:scale-95 transition"
                >
                  Salvar Alteração
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODO 3: APRESENTAÇÃO DE SLIDES */}
      {viewMode === 'slideshow' && filteredItems.length > 0 && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col justify-between select-none">
          <div className="absolute top-0 inset-x-0 z-20 p-3 space-y-3 bg-gradient-to-b from-black/80 to-transparent">
            <div className="flex gap-1">
              {filteredItems.map((item, idx) => (
                <div
                  key={item.id}
                  className="h-1 flex-1 rounded-full bg-white/25 overflow-hidden"
                >
                  <div
                    className={`h-full bg-amber-400 transition-all duration-300 ${
                      idx < slideIndex
                        ? 'w-full'
                        : idx === slideIndex
                          ? 'w-full animate-pulse'
                          : 'w-0'
                    }`}
                  />
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between px-1 text-white">
              <div>
                <h3 className="text-sm font-semibold">
                  {filteredItems[slideIndex]?.title}
                </h3>
                <span className="text-xs text-zinc-300">
                  {filteredItems[slideIndex]?.category} ({slideIndex + 1} de{' '}
                  {filteredItems.length})
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsSlideshowPlaying((p) => !p)}
                  className="p-2 rounded-full bg-white/15 hover:bg-white/25 backdrop-blur-sm"
                  aria-label={isSlideshowPlaying ? 'Pausar' : 'Reproduzir'}
                >
                  {isSlideshowPlaying ? (
                    <Pause className="w-4 h-4" />
                  ) : (
                    <Play className="w-4 h-4" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setViewMode('grid')}
                  className="p-2 rounded-full bg-white/15 hover:bg-white/25 backdrop-blur-sm"
                  aria-label="Sair"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          <div className="relative flex-1 flex items-center justify-center overflow-hidden">
            <button
              type="button"
              onClick={prevSlide}
              className="absolute inset-y-0 left-0 w-1/3 z-10 flex items-center justify-start pl-3 opacity-0 hover:opacity-100 transition"
              aria-label="Anterior"
            >
              <span className="p-2 rounded-full bg-black/50 text-white">
                <ChevronLeft className="w-6 h-6" />
              </span>
            </button>

            {filteredItems[slideIndex]?.type === 'video' ? (
              <video
                key={filteredItems[slideIndex].id}
                src={filteredItems[slideIndex].fullUrl}
                poster={filteredItems[slideIndex].thumbUrl}
                autoPlay
                playsInline
                onEnded={nextSlide}
                className="w-full h-full object-contain"
              />
            ) : (
              <img
                key={filteredItems[slideIndex]?.id}
                src={filteredItems[slideIndex]?.fullUrl}
                alt={filteredItems[slideIndex]?.title}
                loading="lazy"
                className="w-full h-full object-contain"
              />
            )}

            <button
              type="button"
              onClick={nextSlide}
              className="absolute inset-y-0 right-0 w-2/3 z-10 flex items-center justify-end pr-3 opacity-0 hover:opacity-100 transition"
              aria-label="Próximo"
            >
              <span className="p-2 rounded-full bg-black/50 text-white">
                <ChevronRight className="w-6 h-6" />
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
