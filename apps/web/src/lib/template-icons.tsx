import {
  ArrowDownTrayIcon,
  ArrowPathRoundedSquareIcon,
  ArrowUpTrayIcon,
  BeakerIcon,
  BoltIcon,
  BugAntIcon,
  CheckCircleIcon,
  CloudArrowUpIcon,
  CodeBracketIcon,
  CommandLineIcon,
  DocumentTextIcon,
  MagnifyingGlassIcon,
  RocketLaunchIcon,
  SparklesIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";
import type { ComponentType, SVGProps } from "react";

export type TemplateIconComponent = ComponentType<SVGProps<SVGSVGElement>>;

export const TEMPLATE_ICONS: {
  id: string;
  label: string;
  Icon: TemplateIconComponent;
}[] = [
  { id: "document", label: "Document", Icon: DocumentTextIcon },
  { id: "rocket", label: "Rocket", Icon: RocketLaunchIcon },
  { id: "sparkles", label: "Sparkles", Icon: SparklesIcon },
  { id: "wrench", label: "Wrench", Icon: WrenchScrewdriverIcon },
  { id: "bolt", label: "Bolt", Icon: BoltIcon },
  { id: "beaker", label: "Beaker", Icon: BeakerIcon },
  { id: "bug", label: "Bug", Icon: BugAntIcon },
  { id: "check", label: "Check", Icon: CheckCircleIcon },
  { id: "code", label: "Code", Icon: CodeBracketIcon },
  { id: "command", label: "Command line", Icon: CommandLineIcon },
  { id: "search", label: "Search", Icon: MagnifyingGlassIcon },
  { id: "cloud-up", label: "Cloud upload", Icon: CloudArrowUpIcon },
  { id: "upload", label: "Upload", Icon: ArrowUpTrayIcon },
  { id: "download", label: "Download", Icon: ArrowDownTrayIcon },
  { id: "refresh", label: "Refresh", Icon: ArrowPathRoundedSquareIcon },
];

const BY_ID = new Map(TEMPLATE_ICONS.map((entry) => [entry.id, entry.Icon]));

export const DEFAULT_TEMPLATE_ICON: TemplateIconComponent = DocumentTextIcon;

export function templateIconFor(iconId: string | undefined): TemplateIconComponent {
  if (iconId && BY_ID.has(iconId)) return BY_ID.get(iconId)!;
  return DEFAULT_TEMPLATE_ICON;
}
