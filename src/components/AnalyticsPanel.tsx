import { motion, AnimatePresence } from 'framer-motion';
import { useAppState } from '@/context/AppContext';
import { AnalysisSettings, StickyAnalyzeButton } from './AnalysisSettings';
import { SummaryTab } from './panels/SummaryTab';
import { FacilitiesTab } from './panels/FacilitiesTab';
import { SimulationTab } from './panels/SimulationTab';
import { OptimizationTab } from './panels/OptimizationTab';
import { ExportTab } from './panels/ExportTab';
import { PresetsPanel } from './panels/PresetsPanel';

const tabs = [
  { id: 'settings', label: 'Settings' },
  { id: 'presets', label: 'Presets' },
  { id: 'summary', label: 'Summary' },
  { id: 'facilities', label: 'Facilities' },
  { id: 'simulation', label: 'Simulation' },
  { id: 'optimization', label: 'Optimize' },
  { id: 'export', label: 'Export' },
];

export function AnalyticsPanel() {
  const { state, dispatch } = useAppState();

  return (
    <div className="h-full flex flex-col bg-card/50 backdrop-blur-xl border-l border-border">
      {/* Tagline */}
      <div className="px-4 py-2 border-b border-border bg-primary/[0.03]">
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          Accessibility analysis for healthcare services using location-based insights
        </p>
      </div>
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
              {state.activeTab === 'presets' && <PresetsPanel />}
              {state.activeTab === 'summary' && <SummaryTab />}
              {state.activeTab === 'facilities' && <FacilitiesTab />}
              {state.activeTab === 'simulation' && <SimulationTab />}
              {state.activeTab === 'optimization' && <OptimizationTab />}
              {state.activeTab === 'export' && <ExportTab />}
            </motion.div>
          </AnimatePresence>
        </div>

        {state.activeTab === 'settings' && <StickyAnalyzeButton />}

        <div className="border-t border-border px-4 py-3 text-center">
          <a
            href="https://hasibulahmedpulok.vercel.app/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Developed by Hasibul Ahmed Pulok
          </a>
        </div>
      </div>
    </div>
  );
}
