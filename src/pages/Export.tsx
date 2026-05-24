import { useState } from 'react';
import { useAppContext } from '../store/AppContext';
import { PDFDocument, rgb } from 'pdf-lib';
import ExcelJS from 'exceljs';
import { Download, FileText, Table } from 'lucide-react';
import { parseStudentNumbers } from '../utils/studentNumbers';

const Export = () => {
  const { state, dirHandle } = useAppContext();
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const addLog = (msg: string) => setLog(prev => [...prev, msg]);

  const calculateTotalScore = (studentNum: number) => {
    const sc = state.studentScores.find(s => s.studentNumber === studentNum);
    if (!sc) return 0;
    return Object.values(sc.scores).reduce((sum, scoreData) => sum + (scoreData.points || 0), 0);
  };

  const calculateAspectScore = (studentNum: number, perspective: number) => {
    const sc = state.studentScores.find(s => s.studentNumber === studentNum);
    if (!sc) return 0;
    return state.questions.filter(q => q.perspective === perspective).reduce((sum, q) => {
      return sum + (sc.scores[q.id]?.points || 0);
    }, 0);
  };

  const handleExportPdf = async () => {
    if (!dirHandle) return;
    setIsExportingPdf(true);
    setLog(['PDF出力を開始します...']);
    
    try {
      // Get answer PDF
      let answerHandle;
      for await (const [name, handle] of (dirHandle as any).entries()) {
        if (name === '解答用紙.pdf') answerHandle = handle;
      }
      
      if (!answerHandle) {
        addLog('解答用紙.pdf が見つかりません。');
        setIsExportingPdf(false);
        return;
      }

      const file = await (answerHandle as FileSystemFileHandle).getFile();
      const arrayBuffer = await file.arrayBuffer();
      
      const pdfDoc = await PDFDocument.load(arrayBuffer);
      const pages = pdfDoc.getPages();
      
      // We assume 1 page per student
      let pageIndex = 0;
      const students = parseStudentNumbers(state.settings.studentNumberFormat, state.settings.startNumber, state.settings.endNumber, state.settings.absentNumbers);
      for (const i of students) {
        if (pageIndex >= pages.length) break;

        const page = pages[pageIndex];
        const { height } = page.getSize();
        
        const sc = state.studentScores.find(s => s.studentNumber === i);
        
        if (sc) {
          // Draw marks for each question
          for (const q of state.questions) {
            const scoreData = sc.scores[q.id];
            const rect = state.cropSettings.questionRects[q.id];
            if (!scoreData || !rect || scoreData.status === 'unassigned') continue;

            // Coordinates mapping: pdf-lib (0,0) is bottom-left, canvas (0,0) is top-left
            // However, PDF coordinate system can vary based on crop boxes.
            // A simple approximation: pdf-lib uses 72 DPI. If canvas was at e.g., 2.0 scale, we might need to adjust.
            // To keep it simple without complex matrix math, we'll draw based on relative position.
            // For now, let's just place it at an offset from top-left.
            
            // mupdfは1.5倍でレンダリングしているため、1.5で割ることでPDF上の座標と一致します
            const scale = 1.5; 
            const size = 18; // 絶対的なサイズに固定 (18で半透明)
            const x = (rect.x + rect.width) / scale + 10; // 解答欄の外側、右側に配置
            const y = height - ((rect.y + rect.height / 2) / scale); // Center vertically
            
            const red = rgb(0.9, 0.2, 0.2);
            const thickness = 1.5; // 線幅も微調整
            const opacity = 0.5; // 記号を半透明にする
            
            if (scoreData.status === 'correct') {
              // Draw Circle O
              page.drawCircle({ x: x + size/2, y, size: size/2, borderColor: red, borderWidth: thickness, borderOpacity: opacity });
            } else if (scoreData.status === 'incorrect') {
              // Draw Cross X
              const half = size/2;
              page.drawLine({ start: { x: x, y: y - half }, end: { x: x + size, y: y + half }, color: red, thickness, opacity });
              page.drawLine({ start: { x: x, y: y + half }, end: { x: x + size, y: y - half }, color: red, thickness, opacity });
            } else if (scoreData.status === 'partial') {
              // Draw Triangle
              const half = size/2;
              const tY = y - half/2;
              page.drawLine({ start: { x: x + half, y: tY + size }, end: { x: x, y: tY }, color: red, thickness, opacity });
              page.drawLine({ start: { x: x, y: tY }, end: { x: x + size, y: tY }, color: red, thickness, opacity });
              page.drawLine({ start: { x: x + size, y: tY }, end: { x: x + half, y: tY + size }, color: red, thickness, opacity });
              
              // We can draw numbers since standard Helvetica supports numbers!
              page.drawText(`${scoreData.points}`, { x: x + size + 5, y: y - size * 0.3, size: size * 0.8, color: red, opacity });
            }
          }

          // Draw Total score at configured rect
          const scale = 1.5;
          if (state.cropSettings.totalScoreRect) {
            const rect = state.cropSettings.totalScoreRect;
            const x = rect.x / scale;
            const y = height - (rect.y + rect.height) / scale + 5; // Text baseline adjustment
            const fontSize = (rect.height / scale) * 0.8;
            page.drawText(`total:${calculateTotalScore(i)}`, { x, y, size: fontSize, color: rgb(0.9, 0.2, 0.2) });
          }

          // Draw Aspect scores at configured rects
          for (const aspectId of ["1", "2", "3"]) {
            const rect = state.cropSettings.aspectScoreRects?.[aspectId];
            if (rect) {
              const x = rect.x / scale;
              const y = height - (rect.y + rect.height) / scale + 5;
              const fontSize = (rect.height / scale) * 0.8;
              // ※注意: pdf-libの標準フォントは日本語に対応していないため、「観点」ではなく「Aspect」として印字します。
              page.drawText(`Aspect${aspectId}:${calculateAspectScore(i, parseInt(aspectId))}`, { x, y, size: fontSize, color: rgb(0.9, 0.2, 0.2) });
            }
          }
        }

        pageIndex++;
      }

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      
      // Download via File System API
      const newFileHandle = await dirHandle.getFileHandle('採点済み解答用紙.pdf', { create: true });
      const writable = await (newFileHandle as any).createWritable();
      await writable.write(blob);
      await writable.close();
      
      addLog('採点済み解答用紙.pdf を出力しました。');
      
      // Also trigger browser download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '採点済み解答用紙.pdf';
      a.click();
      URL.revokeObjectURL(url);

    } catch (err) {
      console.error(err);
      addLog(`エラー: ${err}`);
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleExportExcel = async () => {
    setIsExportingExcel(true);
    setLog(['Excel出力を開始します...']);

    try {
      const workbook = new ExcelJS.Workbook();
      
      // Sheet 1: Detailed scores
      const sheet1 = workbook.addWorksheet('採点結果詳細');
      const columns = [{ header: '出席番号', key: 'student', width: 10 }];
      
      state.questions.forEach(q => {
        columns.push({ header: `問${q.number}`, key: q.id, width: 8 });
      });
      sheet1.columns = columns;

      const students = parseStudentNumbers(state.settings.studentNumberFormat, state.settings.startNumber, state.settings.endNumber, []);

      students.forEach(studentNum => {
        const isAbsent = state.settings.absentNumbers.includes(studentNum);
        const rowData: any = { student: studentNum };
        
        if (isAbsent) {
          state.questions.forEach(q => {
            rowData[q.id] = '欠席';
          });
        } else {
          const sc = state.studentScores.find(s => s.studentNumber === studentNum);
          state.questions.forEach(q => {
            const scoreData = sc?.scores[q.id];
            if (!scoreData || scoreData.status === 'unassigned') {
              rowData[q.id] = '-';
            } else if (scoreData.status === 'correct') {
              rowData[q.id] = '◯';
            } else if (scoreData.status === 'incorrect') {
              rowData[q.id] = '×';
            } else if (scoreData.status === 'partial') {
              rowData[q.id] = `△(${scoreData.points})`;
            }
          });
        }
        sheet1.addRow(rowData);
      });

      // Sheet 2: Total and Aspect scores
      const sheet2 = workbook.addWorksheet('合計点数一覧');
      sheet2.columns = [
        { header: '出席番号', key: 'student', width: 15 },
        { header: '観点1', key: 'aspect1', width: 10 },
        { header: '観点2', key: 'aspect2', width: 10 },
        { header: '観点3', key: 'aspect3', width: 10 },
        { header: '合計点数', key: 'total', width: 15 }
      ];

      students.forEach(studentNum => {
        const isAbsent = state.settings.absentNumbers.includes(studentNum);
        if (isAbsent) {
          sheet2.addRow({
            student: studentNum,
            aspect1: '欠席',
            aspect2: '欠席',
            aspect3: '欠席',
            total: '欠席'
          });
        } else {
          sheet2.addRow({
            student: studentNum,
            aspect1: calculateAspectScore(studentNum, 1),
            aspect2: calculateAspectScore(studentNum, 2),
            aspect3: calculateAspectScore(studentNum, 3),
            total: calculateTotalScore(studentNum)
          });
        }
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

      if (dirHandle) {
        const fileHandle = await dirHandle.getFileHandle('採点結果.xlsx', { create: true });
        const writable = await (fileHandle as any).createWritable();
        await writable.write(blob);
        await writable.close();
      }

      // Browser download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '採点結果.xlsx';
      a.click();
      URL.revokeObjectURL(url);

      addLog('採点結果.xlsx を出力しました。');
    } catch (err) {
      console.error(err);
      addLog(`エラー: ${err}`);
    } finally {
      setIsExportingExcel(false);
    }
  };

  return (
    <div>
      <h2>6. 結果出力</h2>
      
      <div style={{ display: 'flex', gap: '2rem' }}>
        <div className="card" style={{ flex: 1 }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
            <FileText size={24} color="var(--primary)" /> 採点済みPDFの出力
          </h3>
          <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', minHeight: '60px' }}>
            元の解答用紙PDFに、採点結果の ◯・×・△（部分点）と合計点を赤色で書き込みます。<br/>
            ファイルは作業フォルダに保存され、同時にダウンロードされます。
          </p>
          <button 
            onClick={handleExportPdf}
            disabled={isExportingPdf || !dirHandle}
            style={{ width: '100%', display: 'flex', justifyContent: 'center', gap: '0.5rem' }}
          >
            <Download size={18} /> {isExportingPdf ? '出力中...' : 'PDFを出力する'}
          </button>
        </div>

        <div className="card" style={{ flex: 1 }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
            <Table size={24} color="#10B981" /> 採点結果表(Excel)の出力
          </h3>
          <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', minHeight: '60px' }}>
            生徒ごと・問題ごとの◯×△結果一覧と、生徒の合計点数一覧の2シートを持つExcelファイルを生成します。
          </p>
          <button 
            onClick={handleExportExcel}
            disabled={isExportingExcel}
            style={{ width: '100%', display: 'flex', justifyContent: 'center', gap: '0.5rem', backgroundColor: '#10B981' }}
          >
            <Download size={18} /> {isExportingExcel ? '出力中...' : 'Excelを出力する'}
          </button>
        </div>
      </div>

      {log.length > 0 && (
        <div style={{ 
          marginTop: '2rem', 
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
  );
};

export default Export;
