import React, { useState, useEffect, useRef } from 'react';
import { useAppContext } from '../store/AppContext';
import { Rect } from '../types';
import { Play } from 'lucide-react';

const HANDLE_SIZE = 8;

const Cropping = () => {
  const { state, saveState, dirHandle } = useAppContext();
  const [templateUrl, setTemplateUrl] = useState<string | null>(null);
  
  const [mode, setMode] = useState<'name' | 'question' | 'aggregate'>('name');
  const [selectedQuestionId, setSelectedQuestionId] = useState<string>(
    state.questions.length > 0 ? state.questions[0].id : 'q001'
  );
  const [selectedAggregateId, setSelectedAggregateId] = useState<string>('total');
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [zoomScale, setZoomScale] = useState<number>(1.0);
  
  const [dragState, setDragState] = useState<{
    type: 'move' | 'resize' | 'draw';
    handle?: string;
    targetId: string;
    targetMode: 'name' | 'question' | 'aggregate';
    startMouse: { x: number, y: number };
    startRect: Rect;
  } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  const addLog = (msg: string) => setLog(prev => [...prev, msg]);

  useEffect(() => {
    const loadTemplate = async () => {
      if (!dirHandle) return;
      try {
        const imagesDir = await dirHandle.getDirectoryHandle('images');
        let fileHandle;
        try {
          fileHandle = await imagesDir.getFileHandle('模範解答.jpeg');
        } catch {
          fileHandle = await imagesDir.getFileHandle('模範解答_1.jpeg');
        }
        const file = await fileHandle.getFile();
        const url = URL.createObjectURL(file);
        setTemplateUrl(url);
      } catch (err) {
        console.error("Template image not found.", err);
      }
    };
    loadTemplate();
    return () => { if (templateUrl) URL.revokeObjectURL(templateUrl); };
  }, [dirHandle]);

  const drawRect = (ctx: CanvasRenderingContext2D, rect: Rect, color: string, label: string, isActive: boolean = false) => {
    const { x, y, width, height } = rect;
    ctx.strokeStyle = color;
    ctx.lineWidth = isActive ? 4 : 2;
    
    // アクティブな枠は目立たせるために点線（破線）にする
    if (isActive) {
      ctx.setLineDash([6, 4]);
    } else {
      ctx.setLineDash([]);
    }
    
    ctx.strokeRect(x, y, width, height);
    
    // 塗りつぶしの色（アクティブな場合は不透明度0.35、非アクティブは0.12にして視認性を確保）
    const fillOpacity = isActive ? 0.35 : 0.12;
    ctx.fillStyle = color === '#EF4444' 
      ? `rgba(239, 68, 68, ${fillOpacity})` 
      : `rgba(59, 130, 246, ${fillOpacity})`;
    ctx.fillRect(x, y, width, height);
    
    // ラベル (描画時は破線を解除する)
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.font = isActive ? 'bold 13px sans-serif' : '11px sans-serif';
    ctx.fillText(label, x + 2, y - 4);

    // リサイズハンドルは、現在アクティブな（編集中の）ボックスにのみ表示し
    // どのボックスがアクティブかを一目でわかりやすくする
    if (isActive) {
      const handles = [
        { hx: x, hy: y },
        { hx: x + width, hy: y },
        { hx: x, hy: y + height },
        { hx: x + width, hy: y + height },
        { hx: x + width/2, hy: y },
        { hx: x + width/2, hy: y + height },
        { hx: x, hy: y + height/2 },
        { hx: x + width, hy: y + height/2 },
      ];
      handles.forEach(({ hx, hy }) => {
        ctx.fillStyle = 'white';
        ctx.fillRect(hx - HANDLE_SIZE/2, hy - HANDLE_SIZE/2, HANDLE_SIZE, HANDLE_SIZE);
        ctx.strokeRect(hx - HANDLE_SIZE/2, hy - HANDLE_SIZE/2, HANDLE_SIZE, HANDLE_SIZE);
      });
    }
  };

  const drawRects = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !imageRef.current) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (state.cropSettings.nameRect) {
      const isActive = mode === 'name';
      drawRect(ctx, state.cropSettings.nameRect, '#EF4444', 'Name', isActive);
    }

    Object.entries(state.cropSettings.questionRects || {}).forEach(([qId, rect]) => {
      // qIdが空文字などの不正なキーの場合はスキップ
      if (!qId) return;
      const isActive = mode === 'question' && selectedQuestionId === qId;
      drawRect(ctx, rect, '#3B82F6', `Q: ${qId.replace('q', '')}`, isActive);
    });

    if (state.cropSettings.totalScoreRect) {
      const isActive = mode === 'aggregate' && selectedAggregateId === 'total';
      drawRect(ctx, state.cropSettings.totalScoreRect, '#10B981', 'Total', isActive);
    }

    Object.entries(state.cropSettings.aspectScoreRects || {}).forEach(([aId, rect]) => {
      if (!aId) return;
      const isActive = mode === 'aggregate' && selectedAggregateId === `aspect${aId}`;
      drawRect(ctx, rect, '#8B5CF6', `Aspect ${aId}`, isActive);
    });
  };

  useEffect(() => { drawRects(); }, [state.cropSettings, dragState, templateUrl, zoomScale, mode, selectedQuestionId, selectedAggregateId]);

  useEffect(() => {
    // 過去のバグで空文字('')のキーが保存されてしまっている場合はクリーンアップ
    if (state.cropSettings.questionRects['']) {
      const newRects = { ...state.cropSettings.questionRects };
      delete newRects[''];
      saveState({
        ...state,
        cropSettings: {
          ...state.cropSettings,
          questionRects: newRects
        }
      });
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // テキスト入力中はバックスペースによる削除処理をガード
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'SELECT') {
        return;
      }

      if (e.key === 'Backspace' || e.key === 'Delete') {
        if (mode === 'question' && selectedQuestionId) {
          e.preventDefault();
          const qNum = selectedQuestionId.replace('q', '');
          const confirmDelete = window.confirm(`問題 ${qNum} の解答欄を削除しますか？`);
          if (confirmDelete) {
            const newQuestionRects = { ...state.cropSettings.questionRects };
            delete newQuestionRects[selectedQuestionId];

            const newQuestions = state.questions.filter(q => q.id !== selectedQuestionId);

            // 残っている問題のリストを取得してフォーカスの移動先を決める
            const remainingIds = Object.keys(newQuestionRects).sort();
            const nextSelectedId = remainingIds.length > 0 
              ? remainingIds[remainingIds.length - 1] 
              : '';

            saveState({
              ...state,
              questions: newQuestions,
              cropSettings: {
                ...state.cropSettings,
                questionRects: newQuestionRects
              }
            });
            
            setSelectedQuestionId(nextSelectedId);
            setMode(nextSelectedId ? 'question' : 'name');
          }
        } else if (mode === 'name' && state.cropSettings.nameRect) {
          e.preventDefault();
          const confirmDelete = window.confirm('名前欄の枠を削除しますか？');
          if (confirmDelete) {
            saveState({
              ...state,
              cropSettings: {
                ...state.cropSettings,
                nameRect: null
              }
            });
          }
        } else if (mode === 'aggregate') {
          e.preventDefault();
          if (selectedAggregateId === 'total' && state.cropSettings.totalScoreRect) {
            if (window.confirm('合計点数の枠を削除しますか？')) {
              saveState({ ...state, cropSettings: { ...state.cropSettings, totalScoreRect: null } });
            }
          } else if (selectedAggregateId.startsWith('aspect')) {
            const aId = selectedAggregateId.replace('aspect', '');
            if (state.cropSettings.aspectScoreRects?.[aId]) {
              if (window.confirm(`観点 ${aId} の枠を削除しますか？`)) {
                const newRects = { ...(state.cropSettings.aspectScoreRects || {}) };
                delete newRects[aId];
                saveState({ ...state, cropSettings: { ...state.cropSettings, aspectScoreRects: newRects } });
              }
            }
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mode, selectedQuestionId, state, saveState]);

  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setZoomScale(prev => Math.max(0.2, Math.min(5.0, prev - e.deltaY * 0.005)));
      }
    };
    
    const container = document.getElementById('zoom-container');
    if (container) {
      container.addEventListener('wheel', handleWheel, { passive: false });
    }
    return () => {
      if (container) {
        container.removeEventListener('wheel', handleWheel);
      }
    };
  }, []);

  const getTargetRect = () => {
    if (mode === 'name') return state.cropSettings.nameRect;
    if (mode === 'aggregate') {
      if (selectedAggregateId === 'total') return state.cropSettings.totalScoreRect;
      return state.cropSettings.aspectScoreRects?.[selectedAggregateId.replace('aspect', '')];
    }
    return state.cropSettings.questionRects[selectedQuestionId];
  };

  const setTargetRect = (rect: Rect, overrideId?: string, overrideMode?: 'name' | 'question' | 'aggregate') => {
    const m = overrideMode || mode;
    if (m === 'name') {
      saveState({ ...state, cropSettings: { ...state.cropSettings, nameRect: rect } });
    } else if (m === 'aggregate') {
      const id = overrideId || selectedAggregateId;
      if (id === 'total') {
        saveState({ ...state, cropSettings: { ...state.cropSettings, totalScoreRect: rect } });
      } else {
        const aId = id.replace('aspect', '');
        saveState({ ...state, cropSettings: { ...state.cropSettings, aspectScoreRects: { ...(state.cropSettings.aspectScoreRects || {}), [aId]: rect } } });
      }
    } else {
      const id = overrideId || selectedQuestionId;
      if (!id) return; // 空のIDは保存しない
      saveState({ ...state, cropSettings: { ...state.cropSettings, questionRects: { ...state.cropSettings.questionRects, [id]: rect } } });
    }
  };

  const hitTestGlobal = (x: number, y: number) => {
    const checkRect = (rect: Rect | null) => {
      if (!rect) return null;
      const hs = HANDLE_SIZE;
      const { x: rx, y: ry, width: rw, height: rh } = rect;
      
      if (Math.abs(x - rx) <= hs && Math.abs(y - ry) <= hs) return 'tl';
      if (Math.abs(x - (rx+rw)) <= hs && Math.abs(y - ry) <= hs) return 'tr';
      if (Math.abs(x - rx) <= hs && Math.abs(y - (ry+rh)) <= hs) return 'bl';
      if (Math.abs(x - (rx+rw)) <= hs && Math.abs(y - (ry+rh)) <= hs) return 'br';
      
      if (Math.abs(x - (rx+rw/2)) <= hs && Math.abs(y - ry) <= hs) return 't';
      if (Math.abs(x - (rx+rw/2)) <= hs && Math.abs(y - (ry+rh)) <= hs) return 'b';
      if (Math.abs(x - rx) <= hs && Math.abs(y - (ry+rh/2)) <= hs) return 'l';
      if (Math.abs(x - (rx+rw)) <= hs && Math.abs(y - (ry+rh/2)) <= hs) return 'r';
      
      if (x > rx && x < rx + rw && y > ry && y < ry + rh) return 'inside';
      
      return null;
    };

    // First check the active target
    const activeTarget = getTargetRect();
    const activeId = mode === 'name' ? 'name' : (mode === 'aggregate' ? selectedAggregateId : selectedQuestionId);
    const hitActive = checkRect(activeTarget);
    if (hitActive) return { hit: hitActive, mode, id: activeId, rect: activeTarget! };

    // Then check all others
    const hitName = checkRect(state.cropSettings.nameRect);
    if (hitName) return { hit: hitName, mode: 'name', id: 'name', rect: state.cropSettings.nameRect! };

    for (const [qId, rect] of Object.entries(state.cropSettings.questionRects)) {
      if (!qId) continue;
      const hit = checkRect(rect);
      if (hit) return { hit, mode: 'question', id: qId, rect };
    }

    const hitTotal = checkRect(state.cropSettings.totalScoreRect);
    if (hitTotal) return { hit: hitTotal, mode: 'aggregate', id: 'total', rect: state.cropSettings.totalScoreRect! };

    for (const [aId, rect] of Object.entries(state.cropSettings.aspectScoreRects || {})) {
      if (!aId) continue;
      const hit = checkRect(rect);
      if (hit) return { hit, mode: 'aggregate', id: `aspect${aId}`, rect };
    }

    return null;
  };

  const autoDetectRect = (startX: number, startY: number): Rect => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: startX - 50, y: startY - 20, width: 100, height: 40 };
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { x: startX - 50, y: startY - 20, width: 100, height: 40 };

    const w = canvas.width;
    const h = canvas.height;
    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;

    const isDark = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return true;
      const i = (y * w + x) * 4;
      return (d[i] + d[i+1] + d[i+2]) / 3 < 180;
    };

    let minX = Math.floor(startX);
    let maxX = Math.floor(startX);
    let minY = Math.floor(startY);
    let maxY = Math.floor(startY);

    const MAX_PIXELS = 400000;
    const queueX = new Int32Array(MAX_PIXELS);
    const queueY = new Int32Array(MAX_PIXELS);
    let head = 0;
    let tail = 0;

    queueX[tail] = minX;
    queueY[tail] = minY;
    tail++;

    const visited = new Uint8Array(w * h);
    visited[minY * w + minX] = 1;

    let count = 0;
    while(head < tail && count < MAX_PIXELS) {
      const cx = queueX[head];
      const cy = queueY[head];
      head++;
      count++;

      if (cx < minX) minX = cx;
      if (cx > maxX) maxX = cx;
      if (cy < minY) minY = cy;
      if (cy > maxY) maxY = cy;

      if (maxX - minX > 1200 || maxY - minY > 1200) break;

      const neighbors = [[cx+1, cy], [cx-1, cy], [cx, cy+1], [cx, cy-1]];
      for(let i=0; i<4; i++) {
        const nx = neighbors[i][0];
        const ny = neighbors[i][1];
        if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
          const idx = ny * w + nx;
          if (visited[idx] === 0) {
            visited[idx] = 1;
            if (!isDark(nx, ny) && tail < MAX_PIXELS) {
              queueX[tail] = nx;
              queueY[tail] = ny;
              tail++;
            }
          }
        }
      }
    }

    const width = maxX - minX;
    const height = maxY - minY;

    if (width < 20 || height < 20 || width > 1200 || height > 1200) {
      return { x: startX - 100, y: startY - 30, width: 200, height: 60 };
    }
    return { x: minX - 2, y: minY - 2, width: width + 4, height: height + 4 };
  };

  const moveToNextMode = (currentId?: string) => {
    if (mode === 'name') {
      setMode('question');
      if (!selectedQuestionId) setSelectedQuestionId('q001');
    } else if (mode === 'question') {
      const idToUse = currentId || selectedQuestionId;
      const currentNum = parseInt(idToUse.replace('q', '')) || 0;
      const nextId = `q${(currentNum + 1).toString().padStart(3, '0')}`;
      setSelectedQuestionId(nextId);
    } else if (mode === 'aggregate') {
      const idToUse = currentId || selectedAggregateId;
      if (idToUse === 'total') {
        setSelectedAggregateId('aspect1');
      } else {
        const aNum = parseInt(idToUse.replace('aspect', ''));
        if (aNum < 3) setSelectedAggregateId(`aspect${aNum + 1}`);
      }
    }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || !imageRef.current || !canvasRef.current) return;
    
    const scaleX = imageRef.current.naturalWidth / rect.width;
    const scaleY = imageRef.current.naturalHeight / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    const hitResult = hitTestGlobal(x, y);

    if (hitResult) {
      if (hitResult.mode !== mode || hitResult.id !== (mode === 'question' ? selectedQuestionId : selectedAggregateId)) {
        setMode(hitResult.mode as any);
        if (hitResult.mode === 'question') setSelectedQuestionId(hitResult.id);
        if (hitResult.mode === 'aggregate') setSelectedAggregateId(hitResult.id);
      }

      setDragState({
        type: hitResult.hit === 'inside' ? 'move' : 'resize',
        handle: hitResult.hit !== 'inside' ? hitResult.hit : undefined,
        targetId: hitResult.id,
        targetMode: hitResult.mode as 'name' | 'question' | 'aggregate',
        startMouse: { x, y },
        startRect: { ...hitResult.rect }
      });
    } else {
      let currentId = mode === 'question' ? selectedQuestionId : mode === 'aggregate' ? selectedAggregateId : undefined;
      if (mode === 'question' && !currentId) {
        currentId = 'q001';
      }
      setDragState({
        type: 'draw',
        targetId: currentId || 'name',
        targetMode: mode,
        startMouse: { x, y },
        startRect: { x, y, width: 0, height: 0 }
      });
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    if (!rect || !imageRef.current) return;
    
    const scaleX = imageRef.current.naturalWidth / rect.width;
    const scaleY = imageRef.current.naturalHeight / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    if (!dragState) {
      const hitResult = hitTestGlobal(x, y);
      const hit = hitResult ? hitResult.hit : null;
      if (hit === 'inside') canvasRef.current.style.cursor = 'move';
      else if (hit === 'tl' || hit === 'br') canvasRef.current.style.cursor = 'nwse-resize';
      else if (hit === 'tr' || hit === 'bl') canvasRef.current.style.cursor = 'nesw-resize';
      else if (hit === 't' || hit === 'b') canvasRef.current.style.cursor = 'ns-resize';
      else if (hit === 'l' || hit === 'r') canvasRef.current.style.cursor = 'ew-resize';
      else canvasRef.current.style.cursor = 'crosshair';
      return;
    }

    const { startMouse, startRect, handle, type, targetId, targetMode } = dragState;
    const dx = x - startMouse.x;
    const dy = y - startMouse.y;
    let newRect = { ...startRect };

    if (type === 'move') {
      newRect.x += dx;
      newRect.y += dy;
    } else if (type === 'resize' && handle) {
      if (handle.includes('t')) { newRect.y += dy; newRect.height -= dy; }
      if (handle.includes('b')) { newRect.height += dy; }
      if (handle.includes('l')) { newRect.x += dx; newRect.width -= dx; }
      if (handle.includes('r')) { newRect.width += dx; }
    } else if (type === 'draw') {
      newRect = {
        x: dx > 0 ? startMouse.x : x,
        y: dy > 0 ? startMouse.y : y,
        width: Math.abs(dx),
        height: Math.abs(dy)
      };
    }

    if (type !== 'draw') {
      if (newRect.width < 10) newRect.width = 10;
      if (newRect.height < 10) newRect.height = 10;
    }

    setTargetRect(newRect, targetId, targetMode);
  };

  const handleMouseUp = () => {
    if (dragState && dragState.type === 'draw') {
      const { startMouse, targetId, targetMode } = dragState;
      // Get the final drawn rect from state
      let finalRect = null;
      if (targetMode === 'name') finalRect = state.cropSettings.nameRect;
      else if (targetMode === 'aggregate') finalRect = targetId === 'total' ? state.cropSettings.totalScoreRect : state.cropSettings.aspectScoreRects?.[targetId.replace('aspect', '')];
      else finalRect = state.cropSettings.questionRects[targetId];

      if (!finalRect || (finalRect.width < 5 && finalRect.height < 5)) {
        // It was a click, auto-detect
        const newRect = autoDetectRect(startMouse.x, startMouse.y);
        setTargetRect(newRect, targetId, targetMode);
      } else {
        // Drag was large enough, keep the drawn rect but enforce minimum size just in case
        if (finalRect.width < 10) finalRect.width = 10;
        if (finalRect.height < 10) finalRect.height = 10;
        setTargetRect(finalRect, targetId, targetMode);
      }
      moveToNextMode(targetId);
    }
    setDragState(null);
  };

  const handleCropExecution = async () => {
    if (!dirHandle) return;
    setIsProcessing(true);
    setLog(['トリミング処理を開始します...']);
    try {
      const imagesDir = await dirHandle.getDirectoryHandle('images');
      const trimmedDir = await dirHandle.getDirectoryHandle('trimmed', { create: true });
      const nameDir = await trimmedDir.getDirectoryHandle('Name', { create: true });
      
      for (const qId of Object.keys(state.cropSettings.questionRects)) {
        if (!qId) continue; // 安全のため空IDをスキップ
        await trimmedDir.getDirectoryHandle(qId, { create: true });
      }

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      for await (const [name, handle] of (imagesDir as any).entries()) {
        if (!name.endsWith('.jpeg')) continue;
        const file = await (handle as FileSystemFileHandle).getFile();
        const img = new Image();
        const url = URL.createObjectURL(file);
        await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = url; });

        const isTemplate = name.includes('模範解答');
        const baseName = name.replace('.jpeg', '');

        const cropAndSave = async (rect: Rect, saveDir: FileSystemDirectoryHandle, saveName: string) => {
          if (!ctx) return;
          canvas.width = rect.width;
          canvas.height = rect.height;
          ctx.drawImage(img, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
          const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', 0.9));
          if (blob) {
            const fileHandle = await saveDir.getFileHandle(saveName, { create: true });
            const writable = await (fileHandle as any).createWritable();
            await writable.write(blob);
            await writable.close();
          }
        };

        if (!isTemplate && state.cropSettings.nameRect) {
          await cropAndSave(state.cropSettings.nameRect, nameDir, `${baseName}_name.jpeg`);
        }

        for (const [qId, rect] of Object.entries(state.cropSettings.questionRects)) {
          const qDir = await trimmedDir.getDirectoryHandle(qId);
          const saveName = isTemplate ? `模範解答_${qId.replace('q', '')}.jpeg` : `${baseName}_${qId.replace('q', '')}.jpeg`;
          await cropAndSave(rect, qDir, saveName);
        }

        URL.revokeObjectURL(url);
        addLog(`${name} のトリミング完了`);
      }
      addLog('すべてのトリミングが完了しました。');
    } catch (err) {
      console.error(err);
      addLog(`エラーが発生しました: ${err}`);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div>
      <h2>3. トリミング領域の設定と実行</h2>
      <div style={{ display: 'flex', gap: '2rem', height: 'calc(100vh - 120px)' }}>
        <div className="card" style={{ flex: '0 0 300px', display: 'flex', flexDirection: 'column' }}>
          <h3>設定モード</h3>
          <div style={{ marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <button 
              onClick={() => setMode('name')}
              style={{ backgroundColor: mode === 'name' ? 'var(--primary)' : 'var(--background)', color: mode === 'name' ? 'white' : 'var(--text)' }}
            >
              名前欄の設定
            </button>
            <div style={{ padding: '0.5rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem' }}>解答欄の設定</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <select 
                  value={selectedQuestionId} 
                  onChange={(e) => { setMode('question'); setSelectedQuestionId(e.target.value); }}
                  style={{ flex: 1, padding: '0.5rem', borderRadius: 'var(--radius-md)' }}
                  onClick={() => setMode('question')}
                >
                  {Array.from(new Set([...Object.keys(state.cropSettings.questionRects), selectedQuestionId].filter(Boolean))).sort().map(qId => (
                    <option key={qId} value={qId}>問題 {qId.replace('q', '')}</option>
                  ))}
                </select>
                <button 
                  onClick={() => {
                    const existingIds = Object.keys(state.cropSettings.questionRects).map(id => parseInt(id.replace('q','')) || 0);
                    const nextIdNum = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 1;
                    const nextId = `q${nextIdNum.toString().padStart(3, '0')}`;
                    setSelectedQuestionId(nextId);
                    setMode('question');
                  }}
                  title="解答欄を追加"
                  style={{ padding: '0 0.75rem', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--primary)', color: 'white' }}
                >
                  +
                </button>
              </div>
            </div>

            <div style={{ padding: '0.5rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem' }}>集計欄の設定</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <select 
                  value={selectedAggregateId} 
                  onChange={(e) => { setMode('aggregate'); setSelectedAggregateId(e.target.value); }}
                  style={{ flex: 1, padding: '0.5rem', borderRadius: 'var(--radius-md)' }}
                  onClick={() => setMode('aggregate')}
                >
                  <option value="total">合計点数</option>
                  <option value="aspect1">観点 1</option>
                  <option value="aspect2">観点 2</option>
                  <option value="aspect3">観点 3</option>
                </select>
              </div>
            </div>
          </div>
          
          <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '2rem' }}>
            右側の画像上をクリックすると自動で枠を認識します。枠の端をドラッグしてサイズ調整が可能です。名前欄を設定すると、自動的に問題001へ進みます。
          </p>

          <button 
            onClick={handleCropExecution} 
            disabled={isProcessing || !dirHandle}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '1rem', backgroundColor: 'var(--secondary)' }}
          >
            <Play size={18} /> {isProcessing ? 'トリミング実行中...' : '全画像をトリミング'}
          </button>

          {log.length > 0 && (
            <div style={{ 
              marginTop: '1rem', 
              flex: 1,
              background: 'var(--background)', 
              padding: '0.5rem', 
              borderRadius: 'var(--radius-md)',
              fontSize: '0.8rem',
              overflowY: 'auto'
            }}>
              {log.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          )}
        </div>

        <div id="zoom-container" className="card" style={{ flex: 1, overflow: 'auto', position: 'relative', display: 'flex', justifyContent: zoomScale > 1.0 ? 'flex-start' : 'center', alignItems: 'flex-start', padding: 0 }}>
          {templateUrl && (
            <div style={{
              position: 'absolute',
              top: '1rem',
              right: '1rem',
              zIndex: 100,
              backgroundColor: 'rgba(255, 255, 255, 0.95)',
              backdropFilter: 'blur(4px)',
              padding: '0.35rem 0.5rem',
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-md)',
              display: 'flex',
              gap: '0.25rem',
              alignItems: 'center',
              border: '1px solid var(--border)'
            }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginRight: '0.5rem', fontWeight: 'bold' }}>ズーム:</span>
              <button 
                onClick={() => setZoomScale(1.0)} 
                style={{ 
                  padding: '0.2rem 0.5rem', 
                  fontSize: '0.75rem',
                  backgroundColor: zoomScale === 1.0 ? 'var(--primary)' : 'var(--background)',
                  color: zoomScale === 1.0 ? 'white' : 'var(--text)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  fontWeight: zoomScale === 1.0 ? 'bold' : 'normal'
                }}
              >
                Fit
              </button>
              <button 
                onClick={() => setZoomScale(1.5)} 
                style={{ 
                  padding: '0.2rem 0.5rem', 
                  fontSize: '0.75rem',
                  backgroundColor: zoomScale === 1.5 ? 'var(--primary)' : 'var(--background)',
                  color: zoomScale === 1.5 ? 'white' : 'var(--text)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  fontWeight: zoomScale === 1.5 ? 'bold' : 'normal'
                }}
              >
                1.5x
              </button>
              <button 
                onClick={() => setZoomScale(2.0)} 
                style={{ 
                  padding: '0.2rem 0.5rem', 
                  fontSize: '0.75rem',
                  backgroundColor: zoomScale === 2.0 ? 'var(--primary)' : 'var(--background)',
                  color: zoomScale === 2.0 ? 'white' : 'var(--text)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  fontWeight: zoomScale === 2.0 ? 'bold' : 'normal'
                }}
              >
                2.0x
              </button>
              <button 
                onClick={() => setZoomScale(3.0)} 
                style={{ 
                  padding: '0.2rem 0.5rem', 
                  fontSize: '0.75rem',
                  backgroundColor: zoomScale === 3.0 ? 'var(--primary)' : 'var(--background)',
                  color: zoomScale === 3.0 ? 'white' : 'var(--text)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  fontWeight: zoomScale === 3.0 ? 'bold' : 'normal'
                }}
              >
                3.0x
              </button>
            </div>
          )}

          {templateUrl ? (
            <div style={{ 
              position: 'relative', 
              display: 'inline-block',
              width: zoomScale === 1.0 ? '100%' : `${zoomScale * 100}%`,
              maxWidth: zoomScale === 1.0 ? '100%' : 'none',
              margin: zoomScale > 1.0 ? '0' : 'auto',
              transformOrigin: 'top left'
            }}>
              <img 
                ref={imageRef}
                src={templateUrl} 
                alt="模範解答プレビュー" 
                style={{ display: 'block', width: '100%', height: 'auto' }}
                onLoad={() => {
                  if (canvasRef.current && imageRef.current) {
                    canvasRef.current.width = imageRef.current.naturalWidth;
                    canvasRef.current.height = imageRef.current.naturalHeight;
                    drawRects();
                  }
                }}
              />
              <canvas
                ref={canvasRef}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  cursor: 'crosshair'
                }}
              />
            </div>
          ) : (
            <div style={{ color: 'var(--text-muted)', padding: '2rem' }}>模範解答の画像が見つかりません。「2. PDF変換」を実行してください。</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Cropping;
