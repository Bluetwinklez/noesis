/// <reference types="vite/client" />

declare module 'pdfmake/build/pdfmake';
declare module 'pdfmake/build/vfs_fonts';

interface ImportMetaEnv {
  readonly VITE_APP_VERSION?: string;
}
