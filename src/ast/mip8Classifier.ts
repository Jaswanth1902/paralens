import type {
  ContractStorageLayout,
  Mip8ClassificationResult,
  Mip8PageInfo,
  Mip8Hotspot,
  SlotAccessEvent,
} from './types.js';

/**
 * Classifies contract storage slots into Monad MIP-8 (128-slot) pages and detects cache thrashing / hotspots
 */
export function classifyMip8Pages(
  layout: ContractStorageLayout,
  accessEvents: SlotAccessEvent[] = []
): Mip8ClassificationResult {
  const pages: Mip8PageInfo[] = [];
  const hotspots: Mip8Hotspot[] = [];
  const slotHotspots: Mip8Hotspot[] = [];

  // Group variables by page
  const pageIndices = Object.keys(layout.pageMap)
    .map(Number)
    .sort((a, b) => a - b);

  for (const pageIdx of pageIndices) {
    const slots = layout.pageMap[pageIdx] || [];
    const varsOnPage = layout.variables.filter((v) => v.mip8Page === pageIdx);

    pages.push({
      pageIndex: pageIdx,
      slotCount: slots.length,
      slots,
      variables: varsOnPage,
    });
  }

  // Aggregate access events per slot and per page
  const slotStats: Record<number, { writes: number; reads: number; total: number }> = {};
  const pageStats: Record<number, { writes: number; reads: number; total: number }> = {};

  let totalBlockAccesses = 0;
  let totalBlockWrites = 0;
  for (const ev of accessEvents) {
    totalBlockAccesses += ev.accessFrequency;
    if (ev.accessType === 'WRITE') {
      totalBlockWrites += ev.accessFrequency;
    }

    if (!slotStats[ev.slot]) {
      slotStats[ev.slot] = { writes: 0, reads: 0, total: 0 };
    }
    const page = Math.floor(ev.slot / 128);
    if (!pageStats[page]) {
      pageStats[page] = { writes: 0, reads: 0, total: 0 };
    }

    if (ev.accessType === 'WRITE') {
      slotStats[ev.slot].writes += ev.accessFrequency;
      pageStats[page].writes += ev.accessFrequency;
    } else {
      slotStats[ev.slot].reads += ev.accessFrequency;
      pageStats[page].reads += ev.accessFrequency;
    }
    slotStats[ev.slot].total += ev.accessFrequency;
    pageStats[page].total += ev.accessFrequency;
  }

  // Calculate slot hotspots
  for (const [slotStr, stats] of Object.entries(slotStats)) {
    const slot = Number(slotStr);
    const mip8Page = Math.floor(slot / 128);
    const writeConcentration = totalBlockWrites > 0 ? stats.writes / totalBlockWrites : 0;
    const contentionScore = Math.min(1.0, writeConcentration * 0.9 + (stats.writes > 500 ? 0.1 : 0));

    let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';
    if (contentionScore > 0.7) riskLevel = 'CRITICAL';
    else if (contentionScore > 0.4) riskLevel = 'HIGH';
    else if (contentionScore > 0.2) riskLevel = 'MEDIUM';

    if (contentionScore > 0.1 || stats.writes > 100) {
      slotHotspots.push({
        mip8Page,
        slot,
        contentionScore: Number(contentionScore.toFixed(3)),
        riskLevel,
        reason: `Slot ${slot} has ${stats.writes} writes (${(writeConcentration * 100).toFixed(1)}% of block write volume)`,
      });
    }
  }

  // Calculate page-level contention hotspots (MIP-8 cache thrashing)
  for (const [pageStr, stats] of Object.entries(pageStats)) {
    const page = Number(pageStr);
    const writeConcentration = totalBlockWrites > 0 ? stats.writes / totalBlockWrites : 0;
    const pageContentionScore = Math.min(1.0, writeConcentration * 0.9 + (stats.writes > 1000 ? 0.1 : 0));

    let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';
    if (pageContentionScore > 0.7) riskLevel = 'CRITICAL';
    else if (pageContentionScore > 0.4) riskLevel = 'HIGH';
    else if (pageContentionScore > 0.2) riskLevel = 'MEDIUM';

    if (pageContentionScore > 0.1) {
      hotspots.push({
        mip8Page: page,
        contentionScore: Number(pageContentionScore.toFixed(3)),
        riskLevel,
        reason: `MIP-8 Page ${page} (slots ${page * 128}..${(page + 1) * 128 - 1}) experiences ${stats.writes} concurrent writes`,
      });
    }
  }

  return {
    totalPages: pages.length,
    pages,
    hotspots,
    slotHotspots,
  };
}
