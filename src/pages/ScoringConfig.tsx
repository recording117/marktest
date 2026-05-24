import { useState, useEffect } from 'react';
import { useAppContext } from '../store/AppContext';
import { QuestionSetting } from '../types';
import { Trash2, Play } from 'lucide-react';
import Tesseract from 'tesseract.js';

const ScoringConfig = () => {
  const { state, saveState, dirHandle } = useAppContext();
  const [isProcessing, setIsProcessing] = useState(false);
  const [isReadingTemplate, setIsReadingTemplate] = useState(false);
  const [log, setLog] = useState<string[]>([]);

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
              maxPoints: 10,
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

      for (const q of autoGradeQuestions) {
        addLog(`問題 ${q.number} の模範解答を読み込み中...`);
        try {
          const qDir = await trimmedDir.getDirectoryHandle(q.id);
          const templateHandle = await qDir.getFileHandle(`模範解答_${q.number}.jpeg`);
          const file = await templateHandle.getFile();
          const result = await Tesseract.recognize(file, 'eng+jpn');
          const templateText = result.data.text.trim().replace(/\s+/g, '');
          
          const qIndex = newQuestions.findIndex(x => x.id === q.id);
          if (qIndex !== -1) {
            newQuestions[qIndex] = { ...newQuestions[qIndex], expectedAnswer: templateText };
          }
          addLog(`模範解答 (${q.number}): ${templateText}`);
        } catch (e) {
          addLog(`警告: 問題 ${q.number} の模範解答が見つからないか読み込めません。`);
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

        // Process student answers
        for await (const [name, handle] of (qDir as any).entries()) {
          if (!name.endsWith('.jpeg') || name.includes('模範解答')) continue;
          
          const studentNumStr = name.split('_')[0];
          const studentNum = parseInt(studentNumStr);
          if (isNaN(studentNum)) continue;

          try {
            const file = await (handle as FileSystemFileHandle).getFile();
            let result;
            if (whitelist) {
              result = await Tesseract.recognize(file, 'eng+jpn', {
                tessedit_char_whitelist: whitelist
              } as any);
            } else {
              result = await Tesseract.recognize(file, 'eng+jpn');
            }
            const studentText = result.data.text.trim().replace(/\s+/g, '');
            
            // Simple exact match grading (can be improved)
            const isCorrect = templateText && studentText === templateText;
            
            const sc = getOrCreateStudentScore(studentNum);
            sc.scores[q.id] = {
              status: isCorrect ? 'correct' : 'incorrect',
              points: isCorrect ? q.maxPoints : 0,
              ocrText: studentText,
              isOcrVerified: false // Flag for human to verify
            };
          } catch (e) {
            console.error(`Error processing ${name}`, e);
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h3>問題一覧と設定</h3>
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
                      style={{ width: '80px' }}
                    />
                  </td>
                  <td style={{ padding: '1rem' }}>
                    <input 
                      type="number" 
                      value={q.maxPoints} 
                      onChange={(e) => handleUpdateQuestion(q.id, { maxPoints: parseInt(e.target.value) || 0 })}
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
