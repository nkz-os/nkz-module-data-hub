/// <reference types="vite/client" />
/// <reference types="@testing-library/jest-dom" />

declare module '*?worker' {
  const workerConstructor: new () => Worker;
  export default workerConstructor;
}
