import './App.css';
import { MainChart } from './components/layout/MainChart';
import { SubCharts } from './components/layout/SubCharts';
import { Sidebar } from './components/layout/Sidebar';
import { WhyPanel } from './components/layout/WhyPanel';

function App() {
  return (
    <div className="h-screen w-screen flex flex-col bg-[var(--bg-primary)]">
      {/* Header */}
      <header className="h-10 flex items-center px-4 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-[var(--accent-blue)]">LiquidityHunter</span>
          <span className="text-[var(--text-secondary)] text-sm">|</span>
          <nav className="flex items-center gap-4 text-sm">
            <button className="text-[var(--text-primary)] hover:text-[var(--accent-blue)]">차트</button>
            <button className="text-[var(--text-secondary)] hover:text-[var(--accent-blue)]">스크리너</button>
            <button className="text-[var(--text-secondary)] hover:text-[var(--accent-blue)]">설정</button>
          </nav>
        </div>
        <div className="ml-auto flex items-center gap-4">
          <select className="bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded px-2 py-1 text-sm">
            <option value="KR">KR 한국</option>
            <option value="US">US 미국</option>
          </select>
        </div>
      </header>

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Chart area */}
        <div className="flex-1 flex flex-col">
          {/* Main chart */}
          <div className="flex-1">
            <MainChart />
          </div>

          {/* Sub charts (RSI, MACD, Volume) */}
          <div className="h-32">
            <SubCharts />
          </div>
        </div>

        {/* Right: Sidebar */}
        <div className="w-72">
          <Sidebar />
        </div>
      </div>

      {/* Footer: WHY panel */}
      <div className="h-14">
        <WhyPanel />
      </div>
    </div>
  );
}

export default App;
