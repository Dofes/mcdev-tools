declare global {
  interface Window {
    acquireVsCodeApi: () => VSCodeApi;
  }
}

export interface VSCodeApi {
  postMessage(message: any): void;
  getState(): any;
  setState(state: any): void;
}

export const vscode: VSCodeApi = window.acquireVsCodeApi();
