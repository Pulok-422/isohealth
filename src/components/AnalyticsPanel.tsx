import { motion, AnimatePresence } from 'framer-motion';
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

      <div className="flex-1 overflow-y-auto min-h-0">
        <AnimatePresence mode="wait">
          <motion.div
            key={state.activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
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

      <StickyAnalyzeButton />
    </div>
  );
}
