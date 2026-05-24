import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import { AppProvider } from './store/AppContext';
import { LayoutDashboard, Settings, Image as ImageIcon, Crop, FileCheck2, FileDown, Menu } from 'lucide-react';
import './index.css';

import Setup from './pages/Setup';
import PdfToImage from './pages/PdfToImage';
import Cropping from './pages/Cropping';
import ScoringConfig from './pages/ScoringConfig';
import Grading from './pages/Grading';
import Export from './pages/Export';

function App() {
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(true);

  return (
    <AppProvider>
      <Router>
        <div className="app-container">
          <button 
            className="hamburger-btn" 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            aria-label="Toggle Menu"
          >
            <Menu size={24} />
          </button>
          <nav className={`sidebar ${isSidebarOpen ? 'open' : 'closed'}`}>
            <div className="sidebar-header">
              <h1>採点効率化</h1>
            </div>
            <ul className="nav-links">
              <li>
                <Link to="/" tabIndex={-1}><Settings size={20} /> 初期設定</Link>
              </li>
              <li>
                <Link to="/convert" tabIndex={-1}><ImageIcon size={20} /> PDF変換</Link>
              </li>
              <li>
                <Link to="/crop" tabIndex={-1}><Crop size={20} /> トリミング</Link>
              </li>
              <li>
                <Link to="/config" tabIndex={-1}><LayoutDashboard size={20} /> 配点設定</Link>
              </li>
              <li>
                <Link to="/grade" tabIndex={-1}><FileCheck2 size={20} /> 採点実行</Link>
              </li>
              <li>
                <Link to="/export" tabIndex={-1}><FileDown size={20} /> 結果出力</Link>
              </li>
            </ul>
          </nav>
          <main className={`main-content ${!isSidebarOpen ? 'sidebar-closed' : ''}`}>
            <Routes>
              <Route path="/" element={<Setup />} />
              <Route path="/convert" element={<PdfToImage />} />
              <Route path="/crop" element={<Cropping />} />
              <Route path="/config" element={<ScoringConfig />} />
              <Route path="/grade" element={<Grading />} />
              <Route path="/export" element={<Export />} />
            </Routes>
          </main>
        </div>
      </Router>
    </AppProvider>
  );
}

export default App;
