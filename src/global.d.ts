export {};

declare global {
  interface Window {
    __NKZ__?: {
      register: (opts: {
        id: string;
        viewerSlots: unknown;
        main: unknown;
        version: string;
      }) => void;
    };
  }
}
