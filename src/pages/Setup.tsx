import { useState, useEffect } from 'react';
import { useAppContext } from '../store/AppContext';
import { FolderOpen, Upload, CheckCircle2 } from 'lucide-react';

const Setup = () => {
  const { state, saveState, dirHandle, setDirHandle } = useAppContext();
  const [status, setStatus] = useState<string>('');
  
  const handleSelectFolder = async () => {
    try {
      // Show directory picker (Requires Chrome/Edge)
      const dirHandle = await (window as any).showDirectoryPicker({
        mode: 'readwrite',
      });
      setDirHandle(dirHandle);
      
      let hasData = false;
      try {
        await dirHandle.getDirectoryHandle('images');
        hasData = true;
      } catch (e) {}
      if (!hasData) {
        try {
          await dirHandle.getDirectoryHandle('trimmed');
          hasData = true;
        } catch (e) {}
      }

      if (hasData) {
        const confirmClear = window.confirm("選択したフォルダには既に images や trimmed フォルダが存在します。\n中のデータをすべて消去して初期化しますか？\n（※キャンセルを押すと、既存のデータを保持して続行します）");
        if (confirmClear) {
          setStatus('既存のデータを消去中...');
          try { await dirHandle.removeEntry('images', { recursive: true }); } catch (e) {}
          try { await dirHandle.removeEntry('trimmed', { recursive: true }); } catch (e) {}
        }
      }

      setStatus('初期化中...');
      // Initialize folders
      await dirHandle.getDirectoryHandle('images', { create: true });
      await dirHandle.getDirectoryHandle('trimmed', { create: true });
      const trimmedHandle = await dirHandle.getDirectoryHandle('trimmed');
      await trimmedHandle.getDirectoryHandle('Name', { create: true });
      
      // Also save some test questions if they don't exist
      if (state.questions.length === 0) {
        const newQuestions = [
          { id: 'q001', number: '001', maxPoints: 10, allowPartialPoints: false, autoGrade: false, perspective: 1 as const }
        ];
        await saveState({ ...state, questions: newQuestions });
        await trimmedHandle.getDirectoryHandle('q001', { create: true });
      }
      
      setStatus('フォルダを初期化しました。');
    } catch (err) {
      console.error(err);
      setStatus('エラーが発生しました、またはキャンセルされました。');
    }
  };

  const defaultFormat = state.settings.studentNumberFormat !== undefined 
    ? state.settings.studentNumberFormat 
    : `${state.settings.startNumber}-${state.settings.endNumber}`;

  const [formatInput, setFormatInput] = useState(defaultFormat);

  useEffect(() => {
    const defaultFmt = state.settings.studentNumberFormat !== undefined 
      ? state.settings.studentNumberFormat 
      : `${state.settings.startNumber}-${state.settings.endNumber}`;
    setFormatInput(defaultFmt);
  }, [state.settings.studentNumberFormat, state.settings.startNumber, state.settings.endNumber]);

  const handleFormatBlur = () => {
    saveState({
      ...state,
      settings: { ...state.settings, studentNumberFormat: formatInput }
    });
  };

  const [absentInput, setAbsentInput] = useState(state.settings.absentNumbers.join(', '));

  const handleAbsentBlur = () => {
    const nums = absentInput.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
    saveState({
      ...state,
      settings: { ...state.settings, absentNumbers: nums }
    });
  };

  // Upload PDFs to the dirHandle directly
  const handleFileUpload = async (file: File, isTemplate: boolean) => {
    if (!dirHandle) {
      alert('先に保存先フォルダを選択してください。');
      return;
    }
    try {
      const fileName = isTemplate ? '模範解答.pdf' : '解答用紙.pdf';
      const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
      const writable = await (fileHandle as any).createWritable();
      await writable.write(file);
      await writable.close();
      setStatus(`${fileName} を保存しました。`);
    } catch (err) {
      console.error(err);
      setStatus(`ファイル保存エラー: ${err}`);
    }
  };

  return (
    <div className="setup-container">
      <h2>1. 初期設定</h2>
      
      <div className="card" style={{ marginBottom: '2rem' }}>
        <h3>作業フォルダの選択</h3>
        <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
          採点データや画像を保存するパソコン内のフォルダを選択してください。
        </p>
        <button onClick={handleSelectFolder} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <FolderOpen size={18} /> フォルダを選択
        </button>
        {dirHandle && (
          <div style={{ marginTop: '1rem', color: 'var(--secondary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <CheckCircle2 size={18} /> 選択済み: {dirHandle.name}
          </div>
        )}
        {status && <div style={{ marginTop: '0.5rem', fontSize: '0.9rem' }}>{status}</div>}
      </div>

      <div className="card" style={{ marginBottom: '2rem' }}>
        <h3>出席番号の設定</h3>
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '300px' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem' }}>対象の出席番号（例: 1-40, 3101-3126, 3201-3225）</label>
            <input 
              type="text" 
              value={formatInput} 
              onChange={(e) => setFormatInput(e.target.value)} 
              onBlur={handleFormatBlur}
              placeholder="例: 1-40, 3101-3126"
              style={{ width: '100%' }}
            />
          </div>
          <div style={{ flex: 1, minWidth: '200px' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem' }}>欠席者（カンマ区切り）</label>
            <input 
              type="text" 
              value={absentInput} 
              onChange={(e) => setAbsentInput(e.target.value)} 
              onBlur={handleAbsentBlur}
              placeholder="例: 3, 12, 25"
              style={{ width: '100%' }}
            />
          </div>
        </div>
      </div>

      <div className="card">
        <h3>PDFファイルの登録</h3>
        <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
          先にフォルダを選択してからアップロードしてください。
        </p>
        
        <div style={{ display: 'flex', gap: '2rem' }}>
          <div style={{ flex: 1, border: '2px dashed var(--border)', padding: '2rem', textAlign: 'center', borderRadius: 'var(--radius-md)' }}>
            <Upload size={32} style={{ color: 'var(--primary)', marginBottom: '1rem' }} />
            <h4>模範解答 PDF</h4>
            <input 
              type="file" 
              accept=".pdf" 
              onChange={(e) => e.target.files && handleFileUpload(e.target.files[0], true)}
              style={{ marginTop: '1rem' }}
            />
          </div>

          <div style={{ flex: 1, border: '2px dashed var(--border)', padding: '2rem', textAlign: 'center', borderRadius: 'var(--radius-md)' }}>
            <Upload size={32} style={{ color: 'var(--primary)', marginBottom: '1rem' }} />
            <h4>解答用紙 PDF</h4>
            <input 
              type="file" 
              accept=".pdf" 
              onChange={(e) => e.target.files && handleFileUpload(e.target.files[0], false)}
              style={{ marginTop: '1rem' }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Setup;
