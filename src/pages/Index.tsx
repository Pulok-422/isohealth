import { AppProvider } from '@/context/AppContext';
import { TopBar } from '@/components/TopBar';
import { HealthMap } from '@/components/HealthMap';
import { AnalyticsPanel } from '@/components/AnalyticsPanel';

const Index = () => {
  return (
    <AppProvider>
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
    </AppProvider>
  );
};

export default Index;
