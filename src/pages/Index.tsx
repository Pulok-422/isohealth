import { AppProvider } from '@/context/AppContext';
import { TopBar } from '@/components/TopBar';
import { HealthMap } from '@/components/HealthMap';
import { AnalyticsPanel } from '@/components/AnalyticsPanel';
import { useVisitorTracking } from '@/hooks/useVisitorTracking';

function IndexContent() {
  useVisitorTracking();

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <TopBar />
      <div className="flex-1 flex overflow-hidden">
        {/* Map - 70% */}
        <div className="flex-1 relative">
          <HealthMap />
        </div>
        {/* Panel - 30% */}
        <div className="w-[380px] flex-shrink-0 hidden md:block">
          <AnalyticsPanel />
        </div>
      </div>
    </div>
  );
}

const Index = () => {
  return (
    <AppProvider>
      <IndexContent />
    </AppProvider>
  );
};

export default Index;
