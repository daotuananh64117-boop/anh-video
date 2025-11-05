export enum TransitionType {
  Fade = 'Fade',
  Dissolve = 'Dissolve',
  SlideLeft = 'Slide Left',
  SlideRight = 'Slide Right',
  WipeUp = 'Wipe Up',
  WipeDown = 'Wipe Down',
}

export interface Scene {
  id: string;
  description: string;
  imagePrompt: string;
  imageDataUrl: string | null;
  duration: number; // in seconds
  transition: TransitionType;
}

export type ProcessState = 'idle' | 'analyzing' | 'generating_images' | 'rendering' | 'done' | 'error';
