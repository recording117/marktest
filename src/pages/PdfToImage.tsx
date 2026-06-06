import { useState } from 'react';
import { useAppContext } from '../store/AppContext';
import { Play } from 'lucide-react';
import { parseStudentNumbers } from '../utils/studentNumbers';
import { get } from 'idb-keyval';

const PdfToImage = () => {
  const { state, dirHandle } = useAppContext();
  const [isProcessing, setIsProcessing] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const addLog = (message: string) => {
    setLog(prev => [...prev, message]);
  };

  const processPdf = async (file: File, isTemplate: boolean) => {
    try {
      // 動的インポートにより、アプリ起動時のトップレベルawaitブロックを回避
      const mupdfModule = await import('mupdf');
      const mupdf = mupdfModule.default || mupdfModule;

      const arrayBuffer = await file.arrayBuffer();
      const doc = mupdf.Document.openDocument(arrayBuffer, "application/pdf");
      const numPages = doc.countPages();

      addLog(`${file.name}: ${numPages} ページを検出しました。`);

      const imagesDir = await dirHandle!.getDirectoryHandle('images', { create: true });

      const validStudentNumbers = parseStudentNumbers(
        state.settings.studentNumberFormat,
        state.settings.startNumber,
        state.settings.endNumber,
        state.settings.absentNumbers
      );

      const pagesPerStudent = state.settings.pagesPerStudent || 1;
      const expectedPages = validStudentNumbers.length * pagesPerStudent;

      if (!isTemplate && numPages !== expectedPages) {
        if (!window.confirm(`警告: 解答用紙PDFのページ数 (${numPages}) と設定された出席者の想定ページ数 (${expectedPages}) が一致しません。\n\nこのまま変換を続行しますか？`)) {
          throw new Error('ユーザーによってキャンセルされました。');
        }
      }

      for (let i = 0; i < numPages; i++) {
        const page = doc.loadPage(i);

        // mupdfはメモリ上で直接描画するため、解像度を少し高め(1.5x)にしてもCanvas上限エラーは起きません
        const pixmap = page.toPixmap(mupdf.Matrix.scale(1.5, 1.5), mupdf.ColorSpace.DeviceRGB, false);
        const jpegBytes = pixmap.asJPEG(90);
        const blob = new Blob([jpegBytes], { type: 'image/jpeg' });

        let fileName = '';
        if (isTemplate) {
          fileName = `模範解答${pagesPerStudent > 1 ? `_${i + 1}` : ''}.jpeg`;
        } else {
          const studentIndex = Math.floor(i / pagesPerStudent);
          const pageIndex = (i % pagesPerStudent) + 1;
          const studentNum = studentIndex < validStudentNumbers.length 
            ? validStudentNumbers[studentIndex] 
            : (validStudentNumbers.length > 0 ? validStudentNumbers[validStudentNumbers.length - 1] + (studentIndex - validStudentNumbers.length + 1) : studentIndex + 1);
          fileName = pagesPerStudent > 1 ? `${studentNum}_${pageIndex}.jpeg` : `${studentNum}.jpeg`;
        }

        const imgFileHandle = await imagesDir.getFileHandle(fileName, { create: true });
        const writable = await (imgFileHandle as any).createWritable();
        await writable.write(blob);
        await writable.close();
        addLog(`${fileName} を保存しました。`);
      }
    } catch (err: any) {
      console.error(err);
      addLog(`エラー: ${file.name} の処理に失敗しました: ${err.message || String(err)}`);
    }
  };

  const handleConvert = async () => {
    if (!dirHandle) {
      alert('先に「1. 初期設定」で作業フォルダを選択してください。');
      return;
    }

    setIsProcessing(true);
    setLog(['変換処理を開始します...']);

    try {
      // Find PDFs from idb-keyval
      const templateFile = await get<File>('templatePdf');
      const answerFile = await get<File>('answerPdf');

      if (templateFile) {
        await processPdf(templateFile, true);
      } else {
        addLog('模範解答PDFが登録されていません。');
      }

      if (answerFile) {
        await processPdf(answerFile, false);
      } else {
        addLog('解答用紙PDFが登録されていません。');
      }

      addLog('すべての変換が完了しました。');
    } catch (err: any) {
      console.error(err);
      addLog(`エラーが発生しました: ${err.message || String(err)}`);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div>
      <h2>2. PDFからJPEGへの変換</h2>

      <div className="card">
        <p style={{ marginBottom: '1.5rem', color: 'var(--text-muted)' }}>
          初期設定でアップロードしたPDFファイルを読み込み、ページごとにJPEG画像に変換して <code>images</code> フォルダに保存します。
        </p>

        <button
          onClick={handleConvert}
          disabled={isProcessing || !dirHandle}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', opacity: isProcessing ? 0.7 : 1 }}
        >
          <Play size={18} /> {isProcessing ? '変換中...' : '変換を実行する'}
        </button>

        {log.length > 0 && (
          <div style={{
            marginTop: '2rem',
            background: 'var(--background)',
            padding: '1rem',
            borderRadius: 'var(--radius-md)',
            fontFamily: 'monospace',
            fontSize: '0.9rem',
            maxHeight: '300px',
            overflowY: 'auto'
          }}>
            {log.map((line, i) => <div key={i}>{line}</div>)}
          </div>
        )}
      </div>
    </div>
  );
};

export default PdfToImage;
