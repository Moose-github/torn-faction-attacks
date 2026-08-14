/// <reference types="vite/client" />

import type { DOMAttributes } from "react";

type MathElementProps = DOMAttributes<MathMLElement> & {
  className?: string;
  display?: "block" | "inline";
};

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      math: MathElementProps;
      mrow: MathElementProps;
      msub: MathElementProps;
      msup: MathElementProps;
      mfrac: MathElementProps;
      mi: MathElementProps;
      mn: MathElementProps;
      mo: MathElementProps;
      mtext: MathElementProps;
      mtable: MathElementProps;
      mtr: MathElementProps;
      mtd: MathElementProps;
    }
  }
}
