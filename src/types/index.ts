export interface AppSettings {
  studentNumberFormat?: string;
  startNumber: number;
  endNumber: number;
  absentNumbers: number[];
}

export interface QuestionSetting {
  id: string; // e.g. "q001"
  number: string; // e.g. "001"
  maxPoints: number;
  allowPartialPoints: boolean;
  autoGrade: boolean;
  perspective: 1 | 2 | 3 | null;
  expectedAnswer?: string;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CropSettings {
  nameRect: Rect | null;
  questionRects: Record<string, Rect>; // key is question id
  totalScoreRect: Rect | null;
  aspectScoreRects: Record<string, Rect>; // key is perspective (e.g. "1", "2", "3")
}

export type GradeResult = 'correct' | 'incorrect' | 'partial' | 'unassigned';

export interface ScoreData {
  status: GradeResult;
  points: number; // For partial points, or 0/maxPoints
  ocrText?: string;
  isOcrVerified?: boolean;
}

export interface StudentScore {
  studentNumber: number;
  scores: Record<string, ScoreData>; // key is question id
}

// idb-keyval root state
export interface ProjectState {
  settings: AppSettings;
  questions: QuestionSetting[];
  cropSettings: CropSettings;
  studentScores: StudentScore[];
  // directory handle stored separately since it cannot be easily serialized with normal JSON
}
