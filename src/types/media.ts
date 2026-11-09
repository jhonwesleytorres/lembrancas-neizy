export type EventCategory = 'Casamento' | 'Revelação';

export type ViewMode = 'grid' | 'slideshow';

export type MediaType = 'image' | 'video';

export interface MediaItem {
  id: string;
  title: string;
  category: EventCategory;
  type: MediaType;
  /** URL da versão otimizada em alta definição (WebP/AVIF máx 1920px ou WebM/MP4) */
  fullUrl: string;
  /** URL da miniatura super leve (WebP 400x400 ~20KB) exclusiva para a visualização em Grade */
  thumbUrl: string;
  width?: number;
  height?: number;
  originalSize: number;
  optimizedSize: number;
  thumbSize?: number;
  format: string;
  createdAt: number;
  isFavorite?: boolean;
}
