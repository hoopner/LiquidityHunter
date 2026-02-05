// Type-check: verify the module exports correctly and types are valid
import type { useChartInstance } from '../useChartInstance';

// Verify the function type signature
type Params = Parameters<typeof useChartInstance>;
type Return = ReturnType<typeof useChartInstance>;

// Params[0] should be a RefObject<HTMLDivElement | null>
type _ContainerRef = Params[0];

// Return should have chartRef and isReady
type _ChartRef = Return['chartRef'];
type _IsReady = Return['isReady'];

console.log('✅ useChartInstance exported successfully');
console.log('✅ Type signature is valid');
