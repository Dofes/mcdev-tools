import { useEffect, useRef } from 'react';
import { logger } from '../logger';

/**
 * 自动初始化组件的默认值
 * 当组件挂载时，检查缺失的字段并自动设置默认值
 * 
 * @param data 当前数据对象
 * @param defaults 默认值配置对象
 * @param onDataChange 数据变更回调函数
 * @param markAsChanged 标记数据已更改的回调（可选，用于触发自动保存）
 */
export function useDefaultValues<T extends Record<string, any>>(
  data: T,
  defaults: Partial<T>,
  onDataChange: (field: string, value: any) => void,
  markAsChanged?: () => void
) {
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    let hasInitialized = false;
    Object.entries(defaults).forEach(([key, defaultValue]) => {
      if (data[key] === undefined) {
        onDataChange(key, defaultValue);
        hasInitialized = true;
      }
    });

    if (hasInitialized && markAsChanged) {
      markAsChanged();
    }
  }, []);
}

/**
 * 自动初始化嵌套对象（如 window_style, debug_options）的默认值
 * 当组件挂载时，检查缺失的字段并自动设置默认值
 * 
 * @param data 当前嵌套数据对象（可能是 undefined）
 * @param defaults 默认值配置对象
 * @param onDataChange 数据变更回调函数
 * @param markAsChanged 标记数据已更改的回调（可选，用于触发自动保存）
 */
export function useNestedDefaultValues<T extends Record<string, any>>(
  data: T | undefined,
  defaults: Partial<T>,
  onDataChange: (field: string, value: any) => void,
  markAsChanged?: () => void
) {
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    let hasInitialized = false;
    Object.entries(defaults).forEach(([key, defaultValue]) => {
      if (!data || data[key] === undefined) {
        onDataChange(key, defaultValue);
        hasInitialized = true;
      }
    });

    if (hasInitialized && markAsChanged) {
      markAsChanged();
    }
  }, []);
}
