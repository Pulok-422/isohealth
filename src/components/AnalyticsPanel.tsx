import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState } from 'react';
import { useAppState } from '@/context/AppContext';
import { AnalysisSettings, StickyAnalyzeButton } from './AnalysisSettings';
import { SummaryTab } from './panels/SummaryTab';
import { FacilitiesTab } from './panels/FacilitiesTab';
import { SimulationTab } from './panels/SimulationTab';
import { OptimizationTab } from './panels/OptimizationTab';
import { ExportTab } from './panels/ExportTab';

const tabs = [
  { id: 'settings', label: 'Settings' },
  { id: 'summary', label: 'Summary' },
  { id: 'facilities', label: 'Facilities' },
  { id: 'simulation', label: 'Simulation' },
  { id: 'optimization', label: 'Optimize' },
  { id: 'export', label: 'Export' },
];

function TypewriterText({
  text,
  speed = 70,
}: {
  text: string;
  speed?: number;
}) {
  const [displayed, setDisplayed] = useState('');

  useEffect(() => {
    let index = 0;
    setDisplayed('');

    const timer = window.setInterval(() => {
      index += 1;
      setDisplayed(text.slice(0, index));

      if (index >= text.length) {
        window.clearInterval(timer);
      }
    }, speed);

    return () => window.clearInterval(timer);
  }, [text, speed]);

  return (
    <span className="inline-flex max-w-full items-center whitespace-nowrap overflow-hidden">
      <span className="truncate">{displayed}</span>
      <span className="ml-0.5 inline-block h-4 w-px shrink-0 bg-primary/70 animate-pulse" />
    </span>
  );
}

export function AnalyticsPanel() {
  const { state, dispatch } = useAppState();

  return (
    <div className="h-full flex flex-col bg-card/50 backdrop-blur-xl border-l border-border">
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => dispatch({ type: 'SET_ACTIVE_TAB', payload: tab.id })}
            className={`panel-tab whitespace-nowrap ${
              state.activeTab === tab.id ? 'panel-tab-active' : 'panel-tab-inactive'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex-1 overflow-y-auto min-h-0">
          <AnimatePresence mode="wait">
            <motion.div
              key={state.activeTab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
              className="h-full"
            >
              {state.activeTab === 'settings' && <AnalysisSettings />}
              {state.activeTab === 'summary' && <SummaryTab />}
              {state.activeTab === 'facilities' && <FacilitiesTab />}
              {state.activeTab === 'simulation' && <SimulationTab />}
              {state.activeTab === 'optimization' && <OptimizationTab />}
              {state.activeTab === 'export' && <ExportTab />}
            </motion.div>
          </AnimatePresence>
        </div>

        {state.activeTab === 'settings' && <StickyAnalyzeButton />}

        <div className="border-t border-border px-4 py-3">
          <a
            href="https://hasibulahmedpulok.vercel.app/"
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-lg border border-primary/15 bg-primary/5 px-3 py-2 text-center shadow-sm transition-colors hover:bg-primary/10"
          >
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Developed by
            </div>
            <div className="mt-1 w-full overflow-hidden whitespace-nowrap text-sm font-semibold text-primary">
              <TypewriterText text="Hasibul Ahmed Pulok" />
            </div>
          </a>
        </div>
      </div>
    </div>
  );
}
