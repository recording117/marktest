import { useState, useEffect } from 'react';
import { useAppContext } from '../store/AppContext';
import { QuestionSetting } from '../types';
import { Trash2, Play } from 'lucide-react';
import Tesseract from 'tesseract.js';
import { GoogleGenerativeAI, Part } from "@google/generative-ai";

async function fileToGenerativePart(file: File) {
  const base64EncodedDataPromise = new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
    reader.readAsDataURL(file);
  });
  return {
    inlineData: { data: await base64EncodedDataPromise, mimeType: file.type },
  };
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const DEFAULT_BATCH_SIZE = 6;
const DEFAULT_RPM_LIMIT = 12;

const executeWithRetry = async (fn: () => Promise<any>, maxRetries = 5) => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      const isRateLimit = e.status === 429 || (e.message && e.message.includes('429')) || (e.message && e.message.includes('Quota exceeded'));
      if (isRateLimit && i < maxRetries - 1) {
        // 15秒, 30秒, 60秒, 120秒... に指数的に伸ばして待機（+ジッター）
        const waitTime = Math.min(15000 * Math.pow(2, i) + Math.random() * 3000, 120000);
        console.warn(`Rate limit exceeded, retrying in ${Math.round(waitTime / 1000)}s...`);
        await wait(waitTime);
        continue;
      }
      throw e;
    }
  }
  throw new Error('リトライ上限に達しました。');
};

// 直前のGeminiリクエスト時刻を保持し、RPM(分あたりのリクエスト数)上限を超えないよう間隔をあける
let lastGeminiCallAt = 0;
const rateLimitGemini = async (rpmLimit: number) => {
  const minInterval = 60000 / Math.max(rpmLimit, 1);
  const elapsed = Date.now() - lastGeminiCallAt;
  if (elapsed < minInterval) {
    await wait(minInterval - elapsed);
  }
  lastGeminiCallAt = Date.now();
};

const OCR_INSTRUCTION = 'この画像の解答を読み取ってください。問題番号（例: (1)など）や単位（cm, gなど）はすべて除外し、解答となる文字・数字だけを出力してください。読めない場合や空欄の場合は出力なし（空文字）にしてください。';

// 複数の画像をまとめて1回のリクエストで処理し、APIの呼び出し回数を削減する
const batchRecognizeText = async (
  genAI: GoogleGenerativeAI,
  modelName: string,
  rpmLimit: number,
  items: { label: string; file: File }[]
): Promise<Record<string, string>> => {
  const model = genAI.getGenerativeModel({ model: modelName });
  const parts: Part[] = [
    { text: `これから複数の解答画像を渡します。それぞれの画像ごとに解答を読み取ってください。${OCR_INSTRUCTION}余計な説明は含めないでください。` }
  ];
  for (const item of items) {
    parts.push({ text: `[ラベル: ${item.label}]` });
    parts.push(await fileToGenerativePart(item.file));
  }
  parts.push({
    text: '出力は必ず次のJSON形式のみにしてください。説明文や```などのコードブロック記号は一切付けないでください。\n' +
      `{${items.map(i => `"${i.label}": "解答"`).join(', ')}}`
  });

  await rateLimitGemini(rpmLimit);
  const result = await executeWithRetry(() => model.generateContent(parts));
  const raw = result.response.text().trim();
  const cleaned = raw.replace(/^```json/i, '').replace(/^```/, '').replace(/```\s*$/, '').trim();
  const parsed = JSON.parse(cleaned);

  const out: Record<string, string> = {};
  for (const item of items) {
    const v = parsed[item.label];
    out[item.label] = (v === undefined || v === null) ? '' : String(v).trim().replace(/\s+/g, '');
  }
  return out;
};

// バッチ解析に失敗した場合のフォールバック：1件ずつ個別にリクエストする
const recognizeTextSingle = async (
  genAI: GoogleGenerativeAI,
  modelName: string,
  rpmLimit: number,
  file: File
): Promise<string> => {
  const model = genAI.getGenerativeModel({ model: modelName });
  const imagePart = await fileToGenerativePart(file);
  await rateLimitGemini(rpmLimit);
  const result = await executeWithRetry(() => model.generateContent([OCR_INSTRUCTION, imagePart]));
  return result.response.text().trim().replace(/\s+/g, '');
};

const chunk = <T,>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const ScoringConfig = () => {
  const { state, saveState, dirHandle } = useAppContext();
  const [isProcessing, setIsProcessing] = useState(false);
  const [isReadingTemplate, setIsReadingTemplate] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [forceReprocess, setForceReprocess] = useState(false);

  const addLog = (msg: string) => setLog(prev => [...prev, msg]);

  useEffect(() => {
    const syncQuestions = async () => {
      if (!dirHandle) return;
      try {
        const trimmedDir = await dirHandle.getDirectoryHandle('trimmed');
        const qIds: string[] = [];
        for await (const [name, handle] of (trimmedDir as any).entries()) {
          if (handle.kind === 'directory' && name.startsWith('q')) {
            qIds.push(name);
          }
        }
        qIds.sort();
        
        if (qIds.length > 0) {
          const newQuestions = qIds.map(id => {
            const existing = state.questions.find(q => q.id === id);
            if (existing) return existing;
            return {
              id,
              number: id.replace('q', ''),
              maxPoints: 5,
              allowPartialPoints: false,
              autoGrade: false,
              perspective: 1 as const
            };
          });
          
          const isDifferent = newQuestions.length !== state.questions.length || 
            newQuestions.some((q, i) => q.id !== state.questions[i]?.id);
            
          if (isDifferent) {
            saveState({ ...state, questions: newQuestions });
          }
        } else if (state.questions.length > 0) {
          saveState({ ...state, questions: [] });
        }
      } catch (err) {
        console.error('Failed to sync questions:', err);
      }
    };
    syncQuestions();
  }, [dirHandle, state.questions.length]);

  const handleRemoveQuestion = (id: string) => {
    saveState({
      ...state,
      questions: state.questions.filter(q => q.id !== id)
    });
  };

  const handleUpdateQuestion = (id: string, updates: Partial<QuestionSetting>) => {
    saveState({
      ...state,
      questions: state.questions.map(q => q.id === id ? { ...q, ...updates } : q)
    });
  };

  const handleReadTemplates = async () => {
    if (!dirHandle) {
      alert('作業フォルダが選択されていません。');
      return;
    }
    const autoGradeQuestions = state.questions.filter(q => q.autoGrade);
    if (autoGradeQuestions.length === 0) {
      alert('自動採点(OCR)がONになっている問題がありません。');
      return;
    }

    setIsReadingTemplate(true);
    setLog(['模範解答の読み込みを開始します...']);
    try {
      const trimmedDir = await dirHandle.getDirectoryHandle('trimmed');
      const newQuestions = [...state.questions];
      const batchSize = state.settings.geminiBatchSize || DEFAULT_BATCH_SIZE;
      const rpmLimit = state.settings.geminiRpmLimit || DEFAULT_RPM_LIMIT;

      // 既に模範解答が読み込み済みの問題はスキップ（forceReprocessで上書き可能）
      const targets: { q: QuestionSetting; file: File }[] = [];
      for (const q of autoGradeQuestions) {
        if (q.expectedAnswer && !forceReprocess) {
          addLog(`問題 ${q.number} は読み込み済みのためスキップします。`);
          continue;
        }
        try {
          const qDir = await trimmedDir.getDirectoryHandle(q.id);
          const templateHandle = await qDir.getFileHandle(`模範解答_${q.number}.jpeg`);
          const file = await templateHandle.getFile();
          targets.push({ q, file });
        } catch (e: any) {
          addLog(`警告: 問題 ${q.number} の模範解答画像が見つかりません。詳細: ${e?.message || String(e)}`);
        }
      }

      if (state.settings.geminiApiKey && targets.length > 0) {
        const genAI = new GoogleGenerativeAI(state.settings.geminiApiKey);
        const modelName = state.settings.geminiModelName || 'gemini-1.5-flash';

        // 複数の問題の模範解答をまとめて1回のリクエストで読み取り、API呼び出し回数を削減する
        for (const batch of chunk(targets, batchSize)) {
          addLog(`模範解答をバッチ処理中 (問題 ${batch.map(t => t.q.number).join(', ')})...`);
          try {
            const items = batch.map(t => ({ label: t.q.number, file: t.file }));
            const resultMap = await batchRecognizeText(genAI, modelName, rpmLimit, items);
            for (const t of batch) {
              const templateText = resultMap[t.q.number] ?? '';
              const qIndex = newQuestions.findIndex(x => x.id === t.q.id);
              if (qIndex !== -1) {
                newQuestions[qIndex] = { ...newQuestions[qIndex], expectedAnswer: templateText };
              }
              addLog(`模範解答 (${t.q.number}): ${templateText}`);
            }
          } catch (e: any) {
            console.error(e);
            addLog(`警告: バッチ処理に失敗したため個別に再試行します。詳細: ${e?.message || String(e)}`);
            for (const t of batch) {
              try {
                const templateText = await recognizeTextSingle(genAI, modelName, rpmLimit, t.file);
                const qIndex = newQuestions.findIndex(x => x.id === t.q.id);
                if (qIndex !== -1) {
                  newQuestions[qIndex] = { ...newQuestions[qIndex], expectedAnswer: templateText };
                }
                addLog(`模範解答 (${t.q.number}): ${templateText}`);
              } catch (e2: any) {
                console.error(e2);
                addLog(`警告: 問題 ${t.q.number} の読み込みに失敗しました。詳細: ${e2?.message || String(e2)}`);
              }
            }
          }
        }
      } else {
        for (const t of targets) {
          try {
            const result = await Tesseract.recognize(t.file, 'eng+jpn');
            const templateText = result.data.text.trim().replace(/\s+/g, '');
            const qIndex = newQuestions.findIndex(x => x.id === t.q.id);
            if (qIndex !== -1) {
              newQuestions[qIndex] = { ...newQuestions[qIndex], expectedAnswer: templateText };
            }
            addLog(`模範解答 (${t.q.number}): ${templateText}`);
          } catch (e: any) {
            console.error(e);
            addLog(`警告: 問題 ${t.q.number} の読み込みに失敗しました。詳細: ${e?.message || String(e)}`);
          }
        }
      }

      await saveState({ ...state, questions: newQuestions });
      addLog('模範解答の読み込みが完了しました。');
    } catch (err) {
      console.error(err);
      addLog(`エラー: ${err}`);
    } finally {
      setIsReadingTemplate(false);
    }
  };

  const handleExecuteOcr = async () => {
    if (!dirHandle) {
      alert('作業フォルダが選択されていません。');
      return;
    }
    
    const autoGradeQuestions = state.questions.filter(q => q.autoGrade);
    if (autoGradeQuestions.length === 0) {
      alert('自動採点(OCR)がONになっている問題がありません。');
      return;
    }

    setIsProcessing(true);
    setLog(['OCR処理を開始します...']);

    try {
      const trimmedDir = await dirHandle.getDirectoryHandle('trimmed');
      const newStudentScores = [...state.studentScores];

      // Helper to initialize or get student score
      const getOrCreateStudentScore = (studentNum: number) => {
        let sc = newStudentScores.find(s => s.studentNumber === studentNum);
        if (!sc) {
          sc = { studentNumber: studentNum, scores: {} };
          newStudentScores.push(sc);
        }
        return sc;
      };

      for (const q of autoGradeQuestions) {
        addLog(`問題 ${q.number} のOCR処理を開始...`);
        let qDir;
        try {
          qDir = await trimmedDir.getDirectoryHandle(q.id);
        } catch {
          addLog(`警告: ${q.id} のフォルダが見つかりません。スキップします。`);
          continue;
        }

        // Get template text to compare against
        const templateText = q.expectedAnswer || '';
        if (!templateText) {
          addLog(`警告: 問題 ${q.number} の正解（模範解答）が空です。全て不正解になる可能性があります。`);
        }

        // Determine whitelist based on expected answer
        let whitelist = '';
        if (/^\d+$/.test(templateText)) {
          whitelist = '0123456789';
          addLog(`  -> 文字種推測: 数字`);
        } else if (/^[a-zA-Z]+$/.test(templateText)) {
          whitelist = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
          addLog(`  -> 文字種推測: アルファベット`);
        } else if (/^[ァ-ヶー]+$/.test(templateText)) {
          whitelist = 'ァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロヮワヰヱヲンヴヵヶー';
          addLog(`  -> 文字種推測: カタカナ`);
        } else if (/^[ぁ-んー]+$/.test(templateText)) {
          whitelist = 'ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろゎわゐゑをんー';
          addLog(`  -> 文字種推測: ひらがな`);
        }

        // Gather student answer files, skipping ones already graded (unless forced)
        const targets: { studentNum: number; file: File }[] = [];
        for await (const [name, handle] of (qDir as any).entries()) {
          if (!name.endsWith('.jpeg') || name.includes('模範解答')) continue;

          const studentNumStr = name.split('_')[0];
          const studentNum = parseInt(studentNumStr);
          if (isNaN(studentNum)) continue;

          const existing = newStudentScores.find(s => s.studentNumber === studentNum)?.scores[q.id];
          if (existing && (existing.isOcrVerified || existing.ocrText !== undefined) && !forceReprocess) {
            continue; // 既に採点・OCR処理済みなのでAPI呼び出しをスキップ
          }

          try {
            const file = await (handle as FileSystemFileHandle).getFile();
            targets.push({ studentNum, file });
          } catch (e: any) {
            console.error(`Error reading ${name}`, e);
            addLog(`エラー: ${name} の読み込みに失敗。詳細: ${e?.message || String(e)}`);
          }
        }

        if (targets.length === 0) {
          addLog(`問題 ${q.number}: 新たに処理する解答がありません（既に採点済み）。`);
          continue;
        }
        addLog(`問題 ${q.number}: ${targets.length}件を処理します。`);

        const applyResult = (studentNum: number, studentText: string) => {
          const isCorrect = !!templateText && studentText === templateText;
          const sc = getOrCreateStudentScore(studentNum);
          sc.scores[q.id] = {
            status: isCorrect ? 'correct' : 'incorrect',
            points: isCorrect ? q.maxPoints : 0,
            ocrText: studentText,
            isOcrVerified: false // Flag for human to verify
          };
        };

        if (state.settings.geminiApiKey) {
          const genAI = new GoogleGenerativeAI(state.settings.geminiApiKey);
          const modelName = state.settings.geminiModelName || 'gemini-1.5-flash';
          const batchSize = state.settings.geminiBatchSize || DEFAULT_BATCH_SIZE;
          const rpmLimit = state.settings.geminiRpmLimit || DEFAULT_RPM_LIMIT;

          // 複数生徒分の画像をまとめて1回のリクエストで処理し、API呼び出し回数を削減する
          for (const batch of chunk(targets, batchSize)) {
            addLog(`  -> ${batch.map(t => t.studentNum).join(', ')}番をバッチ処理中...`);
            try {
              const items = batch.map(t => ({ label: String(t.studentNum), file: t.file }));
              const resultMap = await batchRecognizeText(genAI, modelName, rpmLimit, items);
              for (const t of batch) {
                applyResult(t.studentNum, resultMap[String(t.studentNum)] ?? '');
              }
            } catch (e: any) {
              console.error(e);
              addLog(`警告: バッチ処理に失敗したため個別に再試行します。詳細: ${e?.message || String(e)}`);
              for (const t of batch) {
                try {
                  const studentText = await recognizeTextSingle(genAI, modelName, rpmLimit, t.file);
                  applyResult(t.studentNum, studentText);
                } catch (e2: any) {
                  console.error(`Error processing student ${t.studentNum}`, e2);
                  addLog(`エラー: ${t.studentNum}番の処理に失敗。詳細: ${e2?.message || String(e2)}`);
                }
              }
            }
          }
        } else {
          for (const t of targets) {
            try {
              let result;
              if (whitelist) {
                result = await Tesseract.recognize(t.file, 'eng+jpn', {
                  tessedit_char_whitelist: whitelist
                } as any);
              } else {
                result = await Tesseract.recognize(t.file, 'eng+jpn');
              }
              const studentText = result.data.text.trim().replace(/\s+/g, '');
              applyResult(t.studentNum, studentText);
            } catch (e: any) {
              console.error(`Error processing student ${t.studentNum}`, e);
              addLog(`エラー: ${t.studentNum}番の処理に失敗。詳細: ${e?.message || String(e)}`);
            }
          }
        }

        addLog(`問題 ${q.number} のOCR完了`);
      }

      await saveState({
        ...state,
        studentScores: newStudentScores
      });
      addLog('すべてのOCR処理が完了しました。');

    } catch (err) {
      console.error(err);
      addLog(`エラー: ${err}`);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div>
      <h2>4. 配点・自動採点設定</h2>

      <div className="card" style={{ marginBottom: '2rem' }}>
        <h3>高精度OCR (Gemini API) の設定</h3>
        <p style={{ color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
          手書き文字や単位・問題番号の除去を高精度で行うために、Gemini APIを使用できます。APIキーを設定すると、自動採点時に優先して使用されます。
        </p>
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.2rem' }}>APIキー</label>
          <input 
            type="password"
            value={state.settings.geminiApiKey || ''}
            onChange={(e) => saveState({ ...state, settings: { ...state.settings, geminiApiKey: e.target.value } })}
            placeholder="AIzaSy..."
            style={{ width: '100%', maxWidth: '400px' }}
          />
          <p style={{ fontSize: '0.8rem', marginTop: '0.5rem' }}>
            <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer">Google AI StudioでAPIキーを取得（無料）</a>
          </p>
        </div>
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.2rem' }}>モデル名 (404エラーが出る場合は変更してください)</label>
          <input
            type="text"
            value={state.settings.geminiModelName || 'gemini-1.5-flash'}
            onChange={(e) => saveState({ ...state, settings: { ...state.settings, geminiModelName: e.target.value } })}
            placeholder="gemini-1.5-flash"
            style={{ width: '100%', maxWidth: '400px' }}
          />
          <p style={{ fontSize: '0.8rem', marginTop: '0.5rem', color: 'var(--text-muted)' }}>
            無料枠の上限に達しやすい場合は、より上限の緩い gemini-2.0-flash-lite などへの変更も検討してください。
          </p>
        </div>
        <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.2rem' }}>まとめて処理する枚数 (バッチサイズ)</label>
            <input
              type="number"
              min={1}
              max={20}
              value={state.settings.geminiBatchSize ?? DEFAULT_BATCH_SIZE}
              onChange={(e) => saveState({ ...state, settings: { ...state.settings, geminiBatchSize: Math.max(1, parseInt(e.target.value) || DEFAULT_BATCH_SIZE) } })}
              style={{ width: '100px' }}
            />
            <p style={{ fontSize: '0.8rem', marginTop: '0.3rem', color: 'var(--text-muted)' }}>
              1回のAPIリクエストでまとめて読み取る画像の枚数です。大きくするほどAPI呼び出し回数が減りますが、認識精度がやや落ちる場合があります。
            </p>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.2rem' }}>APIリクエスト上限 (回/分)</label>
            <input
              type="number"
              min={1}
              max={60}
              value={state.settings.geminiRpmLimit ?? DEFAULT_RPM_LIMIT}
              onChange={(e) => saveState({ ...state, settings: { ...state.settings, geminiRpmLimit: Math.max(1, parseInt(e.target.value) || DEFAULT_RPM_LIMIT) } })}
              style={{ width: '100px' }}
            />
            <p style={{ fontSize: '0.8rem', marginTop: '0.3rem', color: 'var(--text-muted)' }}>
              Google側のレート制限に合わせて、1分あたりのリクエスト数を自動的に調整します。無料枠は通常15回/分なので、余裕を持って12前後を推奨します。
            </p>
          </div>
        </div>
        <div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={forceReprocess}
              onChange={(e) => setForceReprocess(e.target.checked)}
            />
            強制再実行（既に読み込み・採点済みのデータも上書きする）
          </label>
          <p style={{ fontSize: '0.8rem', marginTop: '0.3rem', color: 'var(--text-muted)' }}>
            通常はOFFのままにしてください。ONにしない限り、既に処理済みの模範解答・生徒解答はAPIを再度呼び出さずスキップされ、呼び出し回数の節約になります。
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h3>問題一覧と設定</h3>
          <div style={{ display: 'flex', gap: '1.5rem', fontWeight: 'bold', backgroundColor: 'var(--background)', padding: '0.5rem 1rem', borderRadius: 'var(--radius-md)' }}>
            <span style={{ color: 'var(--primary)' }}>総合計: {state.questions.reduce((sum, q) => sum + q.maxPoints, 0)}点</span>
            <span>観点1: {state.questions.filter(q => q.perspective === 1).reduce((sum, q) => sum + q.maxPoints, 0)}点</span>
            <span>観点2: {state.questions.filter(q => q.perspective === 2).reduce((sum, q) => sum + q.maxPoints, 0)}点</span>
            <span>観点3: {state.questions.filter(q => q.perspective === 3).reduce((sum, q) => sum + q.maxPoints, 0)}点</span>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border)' }}>
                <th style={{ padding: '1rem' }}>問題番号</th>
                <th style={{ padding: '1rem' }}>配点</th>
                <th style={{ padding: '1rem' }}>部分点</th>
                <th style={{ padding: '1rem' }}>自動採点(OCR)</th>
                <th style={{ padding: '1rem' }}>正解（模範解答）</th>
                <th style={{ padding: '1rem' }}>観点別 (1-3)</th>
                <th style={{ padding: '1rem' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {state.questions.map((q) => (
                <tr key={q.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '1rem' }}>
                    <input 
                      type="text" 
                      value={q.number} 
                      onChange={(e) => handleUpdateQuestion(q.id, { number: e.target.value })}
                      onFocus={(e) => e.target.select()}
                      style={{ width: '80px' }}
                    />
                  </td>
                  <td style={{ padding: '1rem' }}>
                    <input 
                      type="number" 
                      value={q.maxPoints} 
                      onChange={(e) => handleUpdateQuestion(q.id, { maxPoints: parseInt(e.target.value) || 0 })}
                      onFocus={(e) => e.target.select()}
                      style={{ width: '80px' }}
                    />
                  </td>
                  <td style={{ padding: '1rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                      <input 
                        type="checkbox" 
                        checked={q.allowPartialPoints}
                        onChange={(e) => handleUpdateQuestion(q.id, { allowPartialPoints: e.target.checked })}
                      />
                      許可する
                    </label>
                  </td>
                  <td style={{ padding: '1rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                      <input 
                        type="checkbox" 
                        checked={q.autoGrade}
                        onChange={(e) => handleUpdateQuestion(q.id, { autoGrade: e.target.checked })}
                      />
                    </label>
                  </td>
                  <td style={{ padding: '1rem' }}>
                    {q.autoGrade ? (
                      <input 
                        type="text" 
                        value={q.expectedAnswer || ''} 
                        onChange={(e) => handleUpdateQuestion(q.id, { expectedAnswer: e.target.value })}
                        placeholder="手入力可"
                        style={{ width: '120px' }}
                      />
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>-</span>
                    )}
                  </td>
                  <td style={{ padding: '1rem' }}>
                    <select 
                      value={q.perspective || 1}
                      onChange={(e) => handleUpdateQuestion(q.id, { perspective: parseInt(e.target.value) as 1|2|3 })}
                      style={{ padding: '0.5rem', borderRadius: 'var(--radius-md)' }}
                    >
                      <option value={1}>観点 1</option>
                      <option value={2}>観点 2</option>
                      <option value={3}>観点 3</option>
                    </select>
                  </td>
                  <td style={{ padding: '1rem' }}>
                    <button 
                      onClick={() => handleRemoveQuestion(q.id)}
                      style={{ backgroundColor: 'var(--incorrect)', color: '#EF4444' }}
                      title="削除"
                    >
                      <Trash2 size={18} />
                    </button>
                  </td>
                </tr>
              ))}
              {state.questions.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                    問題が設定されていません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>自動採点（OCR）の実行</h3>
        <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
          「自動採点(OCR)」がONになっている問題について、解答画像の文字認識を行い、設定された正解と比較して自動的に仮採点を行います。
          <br/>※事前に下の「模範解答を画像から読み込む」か、表の「正解」欄に手動で入力してください。
          <br/>※記述式問題には対応していません。数字や簡単な記号・単語を想定しています。
        </p>

        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
          <button 
            onClick={handleReadTemplates}
            disabled={isReadingTemplate || isProcessing || !dirHandle}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', backgroundColor: 'var(--secondary)', color: 'white' }}
          >
            <Play size={18} /> {isReadingTemplate ? '読み込み中...' : '模範解答を画像から読み込む'}
          </button>
          
          <button 
            onClick={handleExecuteOcr}
            disabled={isProcessing || isReadingTemplate || !dirHandle}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          >
            <Play size={18} /> {isProcessing ? 'OCR処理中...' : 'OCRで生徒の解答を自動採点する'}
          </button>
        </div>

        {log.length > 0 && (
          <div style={{ 
            marginTop: '1.5rem', 
            background: 'var(--background)', 
            padding: '1rem', 
            borderRadius: 'var(--radius-md)',
            fontFamily: 'monospace',
            fontSize: '0.9rem',
            maxHeight: '200px',
            overflowY: 'auto'
          }}>
            {log.map((line, i) => <div key={i}>{line}</div>)}
          </div>
        )}
      </div>

    </div>
  );
};

export default ScoringConfig;
