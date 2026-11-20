import Image from "next/image";

export function BrandMark({ size = 42 }: { size?: number }) {
  return <Image className="brand-mark" src="/icons/kalo-balance-mark.png" alt="" width={size} height={size} unoptimized/>;
}
