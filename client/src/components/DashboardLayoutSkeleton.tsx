import { SeerLoader } from './SeerLoader';

export function DashboardLayoutSkeleton() {
  return (
    <div className="flex min-h-screen bg-[#0a0612] items-center justify-center">
      <SeerLoader size="lg" text="Loading SEER..." />
    </div>
  );
}
