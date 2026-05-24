import { useState, useEffect } from 'react';
import { useAppContext } from '../store/AppContext';
import { Check, X, Minus, Pin, PinOff, CheckCircle2 } from 'lucide-react';
import { GradeResult, ScoreData } from '../types';
import { parseStudentNumbers } from '../utils/studentNumbers';

const Grading = () => {
  const { state, saveState, dirHandle } = useAppContext();
  const [selectedQuestionId, setSelectedQuestionId] = useState<string>(
    state.questions.length > 0 ? state.questions[0].id : ''
  );
  const [filter, setFilter] = useState<'all' | 'unassigned' | 'correct' | 'incorrect' | 'partial' | 'grouped'>('all');
  const [isTemplatePinned, setIsTemplatePinned] = useState(true);
  
  // Object URLs for images to render
  const [templateUrl, setTemplateUrl] = useState<string | null>(null);
  const [studentImages, setStudentImages] = useState<Record<number, string>>({});
  const [nameImages, setNameImages] = useState<Record<number, string>>({});
  
  const [hoveredStudent, setHoveredStudent] = useState<number | null>(null);
  const [focusedStudent, setFocusedStudent] = useState<number | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  const selectedQuestion = state.questions.find(q => q.id === selectedQuestionId);

  // Load images when selected question changes
  useEffect(() => {
    let activeUrls: string[] = [];
    
    const loadImages = async () => {
      if (!dirHandle || !selectedQuestion) return;
      try {
        const trimmedDir = await dirHandle.getDirectoryHandle('trimmed');
        const qDir = await trimmedDir.getDirectoryHandle(selectedQuestion.id);
        const nameDir = await trimmedDir.getDirectoryHandle('Name');

        // Load Template
        try {
          const tHandle = await qDir.getFileHandle(`模範解答_${selectedQuestion.number}.jpeg`);
          const tFile = await tHandle.getFile();
          const tUrl = URL.createObjectURL(tFile);
          setTemplateUrl(tUrl);
          activeUrls.push(tUrl);
        } catch {
          setTemplateUrl(null);
        }

        // Load Students and Names
        const newStudentImgs: Record<number, string> = {};
        const newNameImgs: Record<number, string> = {};
        
        const students = parseStudentNumbers(state.settings.studentNumberFormat, state.settings.startNumber, state.settings.endNumber, state.settings.absentNumbers);
        for (const i of students) {
          
          try {
            const sHandle = await qDir.getFileHandle(`${i}_${selectedQuestion.number}.jpeg`);
            const sFile = await sHandle.getFile();
            const sUrl = URL.createObjectURL(sFile);
            newStudentImgs[i] = sUrl;
            activeUrls.push(sUrl);
          } catch {}

          try {
            const nHandle = await nameDir.getFileHandle(`${i}_name.jpeg`);
            const nFile = await nHandle.getFile();
            const nUrl = URL.createObjectURL(nFile);
            newNameImgs[i] = nUrl;
            activeUrls.push(nUrl);
          } catch {}
        }
        
        setStudentImages(newStudentImgs);
        setNameImages(newNameImgs);

      } catch (err) {
        console.error("Error loading images", err);
      }
    };

    loadImages();

    return () => {
      activeUrls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [dirHandle, selectedQuestionId, state.settings]);

  const updateScore = (studentNum: number, status: GradeResult, points?: number) => {
    if (!selectedQuestion) return;
    
    const newStudentScores = [...state.studentScores];
    let sc = newStudentScores.find(s => s.studentNumber === studentNum);
    
    if (!sc) {
      sc = { studentNumber: studentNum, scores: {} };
      newStudentScores.push(sc);
    }
    
    const currentScore = sc.scores[selectedQuestion.id] || { status: 'unassigned', points: 0 };
    
    sc.scores[selectedQuestion.id] = {
      ...currentScore,
      status,
      points: points !== undefined ? points : (status === 'correct' ? selectedQuestion.maxPoints : 0),
      isOcrVerified: true
    };
    
    saveState({ ...state, studentScores: newStudentScores });
  };

  const getScoreData = (studentNum: number): ScoreData | null => {
    if (!selectedQuestion) return null;
    const sc = state.studentScores.find(s => s.studentNumber === studentNum);
    return sc?.scores[selectedQuestion.id] || null;
  };

  const baseStudentsList = Object.keys(studentImages).map(Number).sort((a,b)=>a-b);
  const getStatus = (num: number) => getScoreData(num)?.status || 'unassigned';

  const grouped = {
    unassigned: baseStudentsList.filter(s => getStatus(s) === 'unassigned'),
    correct: baseStudentsList.filter(s => getStatus(s) === 'correct'),
    incorrect: baseStudentsList.filter(s => getStatus(s) === 'incorrect'),
    partial: baseStudentsList.filter(s => getStatus(s) === 'partial'),
  };

  let filteredStudentsList = baseStudentsList;
  if (filter === 'grouped') {
    filteredStudentsList = [...grouped.unassigned, ...grouped.correct, ...grouped.incorrect, ...grouped.partial];
  } else if (filter !== 'all') {
    filteredStudentsList = grouped[filter];
  }

  const totalStudents = baseStudentsList.length;
  const gradedCurrent = baseStudentsList.filter(s => getStatus(s) !== 'unassigned').length;

  const totalQuestions = state.questions.length;
  const totalTasks = totalQuestions * totalStudents;
  
  let gradedTotal = 0;
  baseStudentsList.forEach(sNum => {
    const st = state.studentScores.find(s => s.studentNumber === sNum);
    if (st) {
      state.questions.forEach(q => {
        if (st.scores[q.id] && st.scores[q.id].status !== 'unassigned') {
          gradedTotal++;
        }
      });
    }
  });

  const currentPercent = totalStudents > 0 ? Math.round((gradedCurrent / totalStudents) * 100) : 0;
  const totalPercent = totalTasks > 0 ? Math.round((gradedTotal / totalTasks) * 100) : 0;

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (focusedStudent === null || !selectedQuestion) return;
      
      if (['1', '2', '3', 'ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault();
      }

      switch (e.key) {
        case '1': // Correct
          updateScore(focusedStudent, 'correct');
          moveToNextStudent();
          break;
        case '2': // Incorrect
          updateScore(focusedStudent, 'incorrect');
          moveToNextStudent();
          break;
        case '3': // Partial
          if (selectedQuestion.allowPartialPoints) {
            const pts = prompt(`部分点を入力してください (最大 ${selectedQuestion.maxPoints}点):`);
            if (pts !== null && !isNaN(parseInt(pts))) {
              updateScore(focusedStudent, 'partial', parseInt(pts));
              moveToNextStudent();
            }
          } else {
            alert('この問題は部分点が許可されていません。');
          }
          break;
        case 'ArrowRight':
        case 'ArrowDown':
          moveToNextStudent();
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          moveToPrevStudent();
          break;
        case 'Enter': {
          e.preventDefault();
          const qIdx = state.questions.findIndex(q => q.id === selectedQuestionId);
          if (qIdx >= 0 && qIdx < state.questions.length - 1) {
            setSelectedQuestionId(state.questions[qIdx + 1].id);
          }
          break;
        }
        case 'Backspace': {
          e.preventDefault();
          const qIdx = state.questions.findIndex(q => q.id === selectedQuestionId);
          if (qIdx > 0) {
            setSelectedQuestionId(state.questions[qIdx - 1].id);
          }
          break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusedStudent, state, selectedQuestionId, filteredStudentsList]);

  useEffect(() => {
    const students = parseStudentNumbers(state.settings.studentNumberFormat, state.settings.startNumber, state.settings.endNumber, state.settings.absentNumbers);
    if (students.length > 0) {
      const firstValid = students[0];
      setFocusedStudent(firstValid);
      setTimeout(() => {
        document.getElementById(`student-card-${firstValid}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
  }, [selectedQuestionId, state.settings]);

  const moveToNextStudent = (currentNum?: number) => {
    const num = currentNum !== undefined ? currentNum : focusedStudent;
    if (num === null) return;
    const idx = filteredStudentsList.indexOf(num);
    if (idx !== -1 && idx < filteredStudentsList.length - 1) {
      const nextId = filteredStudentsList[idx + 1];
      setFocusedStudent(nextId);
      document.getElementById(`student-card-${nextId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      setFocusedStudent(null);
    }
  };

  const moveToPrevStudent = (currentNum?: number) => {
    const num = currentNum !== undefined ? currentNum : focusedStudent;
    if (num === null) return;
    const idx = filteredStudentsList.indexOf(num);
    if (idx > 0) {
      const prevId = filteredStudentsList[idx - 1];
      setFocusedStudent(prevId);
      document.getElementById(`student-card-${prevId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };



  const handleBulkIncorrect = () => {
    if (!selectedQuestion) return;
    
    const newStudentScores = [...state.studentScores];
    const students = Object.keys(studentImages).map(Number);
    
    students.forEach(studentNum => {
      let sc = newStudentScores.find(s => s.studentNumber === studentNum);
      if (!sc) {
        sc = { studentNumber: studentNum, scores: {} };
        newStudentScores.push(sc);
      }
      if (!sc.scores[selectedQuestion.id] || sc.scores[selectedQuestion.id].status === 'unassigned') {
        sc.scores[selectedQuestion.id] = {
          status: 'incorrect',
          points: 0,
          isOcrVerified: true
        };
      }
    });
    
    saveState({ ...state, studentScores: newStudentScores });
  };

  if (!selectedQuestion) {
    return <div>問題を選択するか、配点設定を行ってください。</div>;
  }

  const renderStudentCard = (studentNum: number) => {
    const scoreData = getScoreData(studentNum);
    const status = scoreData?.status || 'unassigned';
    const isFocused = focusedStudent === studentNum;
    
    return (
      <div 
        id={`student-card-${studentNum}`}
        key={studentNum}
        className="card"
        style={{ 
          padding: '1rem', 
          position: 'relative',
          border: isFocused ? '2px solid var(--primary)' : '1px solid var(--border)',
          transform: isFocused ? 'scale(1.02)' : 'none',
          transition: 'all 0.2s',
          outline: 'none'
        }}
        tabIndex={0}
        onMouseEnter={() => setHoveredStudent(studentNum)}
        onMouseLeave={() => setHoveredStudent(null)}
        onMouseMove={(e) => setMousePos({ x: e.clientX, y: e.clientY })}
        onClick={() => setFocusedStudent(studentNum)}
        onFocus={() => setFocusedStudent(studentNum)}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <span style={{ fontWeight: 'bold' }}>
            {studentNum}番
            {status === 'partial' && <span style={{ color: '#3B82F6', marginLeft: '0.5rem', fontSize: '0.9rem' }}>(部分点: {scoreData?.points}点)</span>}
          </span>
          {scoreData?.ocrText && !scoreData?.isOcrVerified && (
            <span style={{ fontSize: '0.8rem', color: 'var(--primary)', display: 'flex', alignItems: 'center' }}>
              <CheckCircle2 size={12} style={{ marginRight: '2px' }}/> OCR推測
            </span>
          )}
        </div>
        
        <div style={{ position: 'relative', cursor: 'pointer' }}>
          <img 
            src={studentImages[studentNum]} 
            alt={`${studentNum}番解答`} 
            style={{ width: '100%', display: 'block', border: '1px solid var(--border)' }}
          />
          {status !== 'unassigned' && (
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              backgroundColor: 
                status === 'correct' ? 'rgba(16, 185, 129, 0.3)' : 
                status === 'incorrect' ? 'rgba(239, 68, 68, 0.3)' : 
                'rgba(59, 130, 246, 0.3)',
              pointerEvents: 'none'
            }} />
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1rem' }}>
          <button 
            tabIndex={-1}
            onClick={(e) => { e.stopPropagation(); updateScore(studentNum, 'correct'); moveToNextStudent(studentNum); }}
            style={{ padding: '0.25rem 0.5rem', backgroundColor: status === 'correct' ? '#10B981' : 'var(--background)', color: status === 'correct' ? 'white' : 'var(--text)' }}
          ><Check size={16}/></button>
          <button 
            tabIndex={-1}
            onClick={(e) => { e.stopPropagation(); updateScore(studentNum, 'incorrect'); moveToNextStudent(studentNum); }}
            style={{ padding: '0.25rem 0.5rem', backgroundColor: status === 'incorrect' ? '#EF4444' : 'var(--background)', color: status === 'incorrect' ? 'white' : 'var(--text)' }}
          ><X size={16}/></button>
          {selectedQuestion.allowPartialPoints && (
            <button 
              tabIndex={-1}
              onClick={(e) => { 
                e.stopPropagation(); 
                const pts = prompt(`部分点 (最大 ${selectedQuestion.maxPoints}点):`);
                if (pts) { updateScore(studentNum, 'partial', parseInt(pts)); moveToNextStudent(studentNum); }
              }}
              style={{ padding: '0.25rem 0.5rem', backgroundColor: status === 'partial' ? '#3B82F6' : 'var(--background)', color: status === 'partial' ? 'white' : 'var(--text)' }}
            ><Minus size={16}/></button>
          )}
        </div>

        {hoveredStudent === studentNum && nameImages[studentNum] && (
          <div style={{
            position: 'fixed', top: mousePos.y + 15, left: mousePos.x + 15,
            backgroundColor: 'white', padding: '0.5rem', borderRadius: '4px', boxShadow: 'var(--shadow-lg)',
            zIndex: 1000, border: '1px solid var(--border)', pointerEvents: 'none'
          }}>
            <img src={nameImages[studentNum]} alt="名前" style={{ height: '40px', objectFit: 'contain' }} />
          </div>
        )}
      </div>
    );
  };

  const renderGrid = (students: number[]) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
      {students.map(renderStudentCard)}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 40px)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2>5. 採点実行</h2>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <select 
            value={selectedQuestionId} 
            onChange={(e) => setSelectedQuestionId(e.target.value)}
            style={{ padding: '0.5rem', borderRadius: 'var(--radius-md)', fontSize: '1.1rem' }}
          >
            {state.questions.map(q => (
              <option key={q.id} value={q.id}>問題 {q.number} (配点: {q.maxPoints})</option>
            ))}
          </select>
          <button onClick={handleBulkIncorrect} style={{ backgroundColor: 'var(--text-muted)' }}>
            未入力を全て不正解
          </button>
          <button onClick={() => { saveState(state); alert('保存しました。'); }} style={{ backgroundColor: 'var(--primary)', color: 'white' }}>
            保存
          </button>
          <button onClick={() => alert('採点が完了しました。出力画面から結果を書き出してください。')} style={{ backgroundColor: '#10B981', color: 'white' }}>
            採点終了
          </button>
        </div>
      </div>

      {isTemplatePinned && templateUrl && (
        <div className="card" style={{ marginBottom: '1rem', position: 'sticky', top: 0, zIndex: 10, display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <h4 style={{ marginBottom: '0.5rem', color: 'var(--primary)' }}>模範解答</h4>
            <img src={templateUrl} alt="模範解答" style={{ maxHeight: '150px', objectFit: 'contain', border: '1px solid var(--border)' }} />
          </div>
          <button onClick={() => setIsTemplatePinned(false)} title="ピン留め解除" style={{ background: 'transparent', color: 'var(--text-muted)', padding: '0.2rem' }}>
            <PinOff size={20} />
          </button>
        </div>
      )}

      {!isTemplatePinned && (
        <button onClick={() => setIsTemplatePinned(true)} style={{ marginBottom: '1rem', alignSelf: 'flex-start', background: 'transparent', color: 'var(--primary)' }}>
          <Pin size={16} style={{ display: 'inline', marginRight: '0.5rem' }} /> 模範解答を表示
        </button>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        {[
          { id: 'all', label: `すべて (${baseStudentsList.length})` },
          { id: 'grouped', label: 'グループごと' },
          { id: 'unassigned', label: `未採点 (${grouped.unassigned.length})` },
          { id: 'correct', label: `正解 (${grouped.correct.length})` },
          { id: 'incorrect', label: `不正解 (${grouped.incorrect.length})` },
          { id: 'partial', label: `部分点 (${grouped.partial.length})` },
        ].map(f => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id as any)}
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: filter === f.id ? 'var(--primary)' : 'transparent',
              color: filter === f.id ? 'white' : 'var(--text)',
              border: filter === f.id ? 'none' : '1px solid var(--border)',
              borderRadius: 'var(--radius-md)'
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div style={{ overflowY: 'auto', paddingBottom: '2rem', flex: 1 }}>
        {filter === 'grouped' ? (
          <>
            {grouped.unassigned.length > 0 && <div><h3 style={{marginBottom: '1rem'}}>未採点 ({grouped.unassigned.length}人)</h3>{renderGrid(grouped.unassigned)}</div>}
            {grouped.correct.length > 0 && <div><h3 style={{marginBottom: '1rem', color: '#10B981'}}>正解 ({grouped.correct.length}人)</h3>{renderGrid(grouped.correct)}</div>}
            {grouped.incorrect.length > 0 && <div><h3 style={{marginBottom: '1rem', color: '#EF4444'}}>不正解 ({grouped.incorrect.length}人)</h3>{renderGrid(grouped.incorrect)}</div>}
            {grouped.partial.length > 0 && <div><h3 style={{marginBottom: '1rem', color: '#3B82F6'}}>部分点 ({grouped.partial.length}人)</h3>{renderGrid(grouped.partial)}</div>}
          </>
        ) : (
          renderGrid(filteredStudentsList)
        )}
      </div>
      
      <div style={{ padding: '1rem', background: 'var(--surface)', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ display: 'flex', gap: '2rem' }}>
          <div><strong>ショートカット:</strong></div>
          <div><kbd>1</kbd> 正解</div>
          <div><kbd>2</kbd> 不正解</div>
          {selectedQuestion.allowPartialPoints && <div><kbd>3</kbd> 部分点</div>}
          <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginLeft: 'auto' }}>※画像をクリックしてフォーカスしてから操作してください</div>
        </div>
        
        <div style={{ display: 'flex', gap: '2rem', fontSize: '0.9rem' }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span style={{ width: '130px', fontWeight: 'bold' }}>現在の問題: {gradedCurrent} / {totalStudents}</span>
            <progress value={gradedCurrent} max={totalStudents} style={{ flex: 1, height: '10px' }}></progress>
            <span style={{ width: '40px', textAlign: 'right' }}>{currentPercent}%</span>
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span style={{ width: '130px', fontWeight: 'bold' }}>全体進捗: {gradedTotal} / {totalTasks}</span>
            <progress value={gradedTotal} max={totalTasks} style={{ flex: 1, height: '10px' }}></progress>
            <span style={{ width: '40px', textAlign: 'right' }}>{totalPercent}%</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Grading;
