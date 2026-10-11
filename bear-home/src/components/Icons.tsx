import { Image } from "@tarojs/components";
import ArrowDownRightgreen from "../assets/icons/ArrowDownRight-green.png";
import ArrowDownRightmuted from "../assets/icons/ArrowDownRight-muted.png";
import ArrowDownRightwhite from "../assets/icons/ArrowDownRight-white.png";
import ArrowLeftgreen from "../assets/icons/ArrowLeft-green.png";
import ArrowLeftmuted from "../assets/icons/ArrowLeft-muted.png";
import ArrowLeftwhite from "../assets/icons/ArrowLeft-white.png";
import ArrowRightgreen from "../assets/icons/ArrowRight-green.png";
import ArrowRightmuted from "../assets/icons/ArrowRight-muted.png";
import ArrowRightwhite from "../assets/icons/ArrowRight-white.png";
import BookOpengreen from "../assets/icons/BookOpen-green.png";
import BookOpenmuted from "../assets/icons/BookOpen-muted.png";
import BookOpenwhite from "../assets/icons/BookOpen-white.png";
import Bookmarkgreen from "../assets/icons/Bookmark-green.png";
import Bookmarkmuted from "../assets/icons/Bookmark-muted.png";
import Bookmarkwhite from "../assets/icons/Bookmark-white.png";
import Checkgreen from "../assets/icons/Check-green.png";
import Checkmuted from "../assets/icons/Check-muted.png";
import Checkwhite from "../assets/icons/Check-white.png";
import ChevronRightgreen from "../assets/icons/ChevronRight-green.png";
import ChevronRightmuted from "../assets/icons/ChevronRight-muted.png";
import ChevronRightwhite from "../assets/icons/ChevronRight-white.png";
import Heartgreen from "../assets/icons/Heart-green.png";
import Heartmuted from "../assets/icons/Heart-muted.png";
import Heartwhite from "../assets/icons/Heart-white.png";
import Homegreen from "../assets/icons/Home-green.png";
import Homemuted from "../assets/icons/Home-muted.png";
import Homewhite from "../assets/icons/Home-white.png";
import LayoutGridgreen from "../assets/icons/LayoutGrid-green.png";
import LayoutGridmuted from "../assets/icons/LayoutGrid-muted.png";
import LayoutGridwhite from "../assets/icons/LayoutGrid-white.png";
import Plusgreen from "../assets/icons/Plus-green.png";
import Plusmuted from "../assets/icons/Plus-muted.png";
import Pluswhite from "../assets/icons/Plus-white.png";
import Searchgreen from "../assets/icons/Search-green.png";
import Searchmuted from "../assets/icons/Search-muted.png";
import Searchwhite from "../assets/icons/Search-white.png";
import Sendgreen from "../assets/icons/Send-green.png";
import Sendmuted from "../assets/icons/Send-muted.png";
import Sendwhite from "../assets/icons/Send-white.png";
import Settings2green from "../assets/icons/Settings2-green.png";
import Settings2muted from "../assets/icons/Settings2-muted.png";
import Settings2white from "../assets/icons/Settings2-white.png";
import Sparklesgreen from "../assets/icons/Sparkles-green.png";
import Sparklesmuted from "../assets/icons/Sparkles-muted.png";
import Sparkleswhite from "../assets/icons/Sparkles-white.png";
import Walletgreen from "../assets/icons/Wallet-green.png";
import Walletmuted from "../assets/icons/Wallet-muted.png";
import Walletwhite from "../assets/icons/Wallet-white.png";
import Xgreen from "../assets/icons/X-green.png";
import Xmuted from "../assets/icons/X-muted.png";
import Xwhite from "../assets/icons/X-white.png";

type IconProps = {
  size?: number;
  strokeWidth?: number;
  tone?: "green" | "muted" | "white";
};
export function ArrowDownRight({ size = 20, tone = "green" }: IconProps) {
  const sources = {
    green: ArrowDownRightgreen,
    muted: ArrowDownRightmuted,
    white: ArrowDownRightwhite,
  };
  return (
    <Image
      className="ui-icon"
      src={sources[tone]}
      style={{ width: `${size}px`, height: `${size}px` }}
      mode="aspectFit"
      ariaHidden
    />
  );
}
export function ArrowRight({ size = 20, tone = "green" }: IconProps) {
  const sources = {
    green: ArrowRightgreen,
    muted: ArrowRightmuted,
    white: ArrowRightwhite,
  };
  return (
    <Image
      className="ui-icon"
      src={sources[tone]}
      style={{ width: `${size}px`, height: `${size}px` }}
      mode="aspectFit"
      ariaHidden
    />
  );
}
export function BookOpen({ size = 20, tone = "green" }: IconProps) {
  const sources = {
    green: BookOpengreen,
    muted: BookOpenmuted,
    white: BookOpenwhite,
  };
  return (
    <Image
      className="ui-icon"
      src={sources[tone]}
      style={{ width: `${size}px`, height: `${size}px` }}
      mode="aspectFit"
      ariaHidden
    />
  );
}
export function Check({ size = 20, tone = "green" }: IconProps) {
  const sources = { green: Checkgreen, muted: Checkmuted, white: Checkwhite };
  return (
    <Image
      className="ui-icon"
      src={sources[tone]}
      style={{ width: `${size}px`, height: `${size}px` }}
      mode="aspectFit"
      ariaHidden
    />
  );
}
export function ChevronRight({ size = 20, tone = "green" }: IconProps) {
  const sources = {
    green: ChevronRightgreen,
    muted: ChevronRightmuted,
    white: ChevronRightwhite,
  };
  return (
    <Image
      className="ui-icon"
      src={sources[tone]}
      style={{ width: `${size}px`, height: `${size}px` }}
      mode="aspectFit"
      ariaHidden
    />
  );
}
export function Heart({ size = 20, tone = "green" }: IconProps) {
  const sources = { green: Heartgreen, muted: Heartmuted, white: Heartwhite };
  return (
    <Image
      className="ui-icon"
      src={sources[tone]}
      style={{ width: `${size}px`, height: `${size}px` }}
      mode="aspectFit"
      ariaHidden
    />
  );
}
export function Home({ size = 20, tone = "green" }: IconProps) {
  const sources = { green: Homegreen, muted: Homemuted, white: Homewhite };
  return (
    <Image
      className="ui-icon"
      src={sources[tone]}
      style={{ width: `${size}px`, height: `${size}px` }}
      mode="aspectFit"
      ariaHidden
    />
  );
}
export function LayoutGrid({ size = 20, tone = "green" }: IconProps) {
  const sources = {
    green: LayoutGridgreen,
    muted: LayoutGridmuted,
    white: LayoutGridwhite,
  };
  return (
    <Image
      className="ui-icon"
      src={sources[tone]}
      style={{ width: `${size}px`, height: `${size}px` }}
      mode="aspectFit"
      ariaHidden
    />
  );
}
export function Plus({ size = 20, tone = "green" }: IconProps) {
  const sources = { green: Plusgreen, muted: Plusmuted, white: Pluswhite };
  return (
    <Image
      className="ui-icon"
      src={sources[tone]}
      style={{ width: `${size}px`, height: `${size}px` }}
      mode="aspectFit"
      ariaHidden
    />
  );
}
export function Settings2({ size = 20, tone = "green" }: IconProps) {
  const sources = {
    green: Settings2green,
    muted: Settings2muted,
    white: Settings2white,
  };
  return (
    <Image
      className="ui-icon"
      src={sources[tone]}
      style={{ width: `${size}px`, height: `${size}px` }}
      mode="aspectFit"
      ariaHidden
    />
  );
}
export function Sparkles({ size = 20, tone = "green" }: IconProps) {
  const sources = {
    green: Sparklesgreen,
    muted: Sparklesmuted,
    white: Sparkleswhite,
  };
  return (
    <Image
      className="ui-icon"
      src={sources[tone]}
      style={{ width: `${size}px`, height: `${size}px` }}
      mode="aspectFit"
      ariaHidden
    />
  );
}
export function Wallet({ size = 20, tone = "green" }: IconProps) {
  const sources = {
    green: Walletgreen,
    muted: Walletmuted,
    white: Walletwhite,
  };
  return (
    <Image
      className="ui-icon"
      src={sources[tone]}
      style={{ width: `${size}px`, height: `${size}px` }}
      mode="aspectFit"
      ariaHidden
    />
  );
}
export function X({ size = 20, tone = "green" }: IconProps) {
  const sources = { green: Xgreen, muted: Xmuted, white: Xwhite };
  return (
    <Image
      className="ui-icon"
      src={sources[tone]}
      style={{ width: `${size}px`, height: `${size}px` }}
      mode="aspectFit"
      ariaHidden
    />
  );
}
export function ArrowLeft({ size = 20, tone = "green" }: IconProps) {
  const sources = {
    green: ArrowLeftgreen,
    muted: ArrowLeftmuted,
    white: ArrowLeftwhite,
  };
  return (
    <Image
      className="ui-icon"
      src={sources[tone]}
      style={{ width: `${size}px`, height: `${size}px` }}
      mode="aspectFit"
      ariaHidden
    />
  );
}
export function Bookmark({ size = 20, tone = "green" }: IconProps) {
  const sources = {
    green: Bookmarkgreen,
    muted: Bookmarkmuted,
    white: Bookmarkwhite,
  };
  return (
    <Image
      className="ui-icon"
      src={sources[tone]}
      style={{ width: `${size}px`, height: `${size}px` }}
      mode="aspectFit"
      ariaHidden
    />
  );
}
export function Search({ size = 20, tone = "green" }: IconProps) {
  const sources = {
    green: Searchgreen,
    muted: Searchmuted,
    white: Searchwhite,
  };
  return (
    <Image
      className="ui-icon"
      src={sources[tone]}
      style={{ width: `${size}px`, height: `${size}px` }}
      mode="aspectFit"
      ariaHidden
    />
  );
}
export function Send({ size = 20, tone = "green" }: IconProps) {
  const sources = { green: Sendgreen, muted: Sendmuted, white: Sendwhite };
  return (
    <Image
      className="ui-icon"
      src={sources[tone]}
      style={{ width: `${size}px`, height: `${size}px` }}
      mode="aspectFit"
      ariaHidden
    />
  );
}
