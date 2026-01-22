
export interface RaceLegImages {
  raceInfo?: string;
  horseComparison?: string;
  jockeyComparison?: string;
  ownerComparison?: string;
  trainerComparison?: string;
  detailedHorseComparison?: string;
  trainingInfo?: string;
}

export interface RaceLeg {
  leg: number;
  images: RaceLegImages;
  link?: string;
}

export interface RaceDetails {
    location: string;
    name: string;
    date: string;
    programUrl?: string;
}

export interface ExternalSource {
  id: string;
  name: string;
  url: string;
  isActive: boolean;
  reputationScore: number; // Uzmanlık puanı
  accuracyHistory: boolean[]; // Son tahmin başarıları
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'ai' | 'system';
  text: string;
  isVoice?: boolean;
  prediction?: {
    leg: number;
    horses: number[];
    reasoning: string;
    sources?: Array<{title: string, uri: string}>;
  };
  // FIX: Added sources to ChatMessage to handle grounding results from Gemini API
  sources?: Array<{title: string, uri: string}>;
}

export interface RaceResult {
  [leg: number]: number | undefined;
}

export interface PerformanceRecord {
  raceId: string;
  leg: number;
  prediction: number[];
  result: number;
  isCorrect: boolean;
  reasoning: string;
}

export interface RaceObservation {
  id: string;
  raceLocation: string;
  raceDate: string;
  leg: number;
  note: string;
  timestamp: number;
}
