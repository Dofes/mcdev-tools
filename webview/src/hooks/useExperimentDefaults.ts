import { useNestedDefaultValues } from '../hooks/useDefaultValues';

interface ExperimentOptions {
  data_driven_biomes?: boolean;
  upcoming_creator_features?: boolean;
  experimental_creator_cameras?: boolean;
  gametest?: boolean;
  deferred_technical_preview?: boolean;
}


export const EXPERIMENT_DEFAULT_VALUES: ExperimentOptions = {
  data_driven_biomes: false,
  upcoming_creator_features: false,
  experimental_creator_cameras: false,
  gametest: false,
  deferred_technical_preview: false,
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
