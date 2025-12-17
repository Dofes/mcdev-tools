import React from 'react';
import { useNestedDefaultValues } from '../hooks/useDefaultValues';

interface ExperimentOptions {
  data_driven_biomes?: boolean;
  data_driven_items?: boolean;
  experimental_molang_features?: boolean;
}


export const EXPERIMENT_DEFAULT_VALUES: ExperimentOptions = {
  data_driven_biomes: false,
  data_driven_items: false,
  experimental_molang_features: false,
};

/**
 * Hook: 自动初始化实验选项的默认值
 */
export function useExperimentDefaults(
  experimentOptions: ExperimentOptions | undefined,
  onExperimentChange: (field: string, checked: boolean) => void,
  markAsChanged?: () => void
) {
  useNestedDefaultValues(experimentOptions, EXPERIMENT_DEFAULT_VALUES, onExperimentChange, markAsChanged);
}
