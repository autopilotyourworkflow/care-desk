"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { BookOpen, ChevronDown, CirclePlay, CircleQuestionMark, Keyboard, Menu as MenuIcon, PenLine, RotateCcw, UserRound, X } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { Menu } from "@/components/ui/Menu";
import { Kbd } from "@/components/ui/Kbd";
import { Avatar } from "@/components/ui/Avatar";
import { Tooltip } from "@/components/ui/Tooltip";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import { isTypingTarget } from "@/components/ui/floating";
import { BUILDER_ABOUT_HREF, ConceptFooter } from "./ConceptFooter";
import { Wordmark } from "./Wordmark";
import { DEFAULT_SHORTCUTS, ShortcutsPanel, type ShortcutGroup } from "./ShortcutsPanel";
import { useSingleKeys } from "./preferences";
import { useSession } from "@/lib/client/session";
import { isPristine } from "@/lib/client/session-state";
import { TourProvider } from "@/components/tour/TourProvider";
import { normalizePath, ROLE_ORDER, ROLES, roleForPath, TOUR_EVENT, TOUR_URL, useRole, type Role, type RoleInfo } from "./roles";

export const NAV_ITEMS = [
  { href: "/desk/", label: "Desk" },
  { href: "/clinician/", label: "Clinician" },
  { href: "/insights/", label: "Insights" },
  { href: "/tests/", label: "Test results" },
  { href: "/how-it-works/", label: "How it works" },
  // The one invitation in the bar: a small pill at the right end of the desktop nav, a plain link in the phone menu.
  { href: "/try/", label: "Try it", pill: true },
] as const;

type NavItem = (typeof NAV_ITEMS)[number];
const isPill = (item: NavItem): boolean => "pill" in item && item.pill;

interface ShellApi {
  role: Role;
  roleInfo: RoleInfo;
  /** Switch the "Viewing as" role and go to that role's home. */
  switchRole: (r: Role) => void;
  openShortcuts: () => void;
  replayTour: () => void;
  /**
   * One-key shortcuts (J, K, E, X, /, ?) are on. Off when the viewer turned them off in the Keyboard shortcuts panel
   * (WCAG 2.1.4). Screens return early from their one-key handlers when this is false; chords such as Ctrl+Enter and
   * Escape keep working.
   */
  singleKeys: boolean;
  setSingleKeys: (on: boolean) => void;
}

const ShellContext = createContext<ShellApi | null>(null);

/** Shell actions for screens (open the shortcuts panel, replay the tour, the current role and signed-in person). */
export function useShell(): ShellApi {
  const ctx = useContext(ShellContext);
  if (ctx) return ctx;
  return {
    role: "agent",
    roleInfo: ROLES.agent,
    switchRole: () => {},
    openShortcuts: () => {},
    replayTour: () => {},
    singleKeys: true,
    setSingleKeys: () => {},
  };
}

export interface AppShellProps {
  children: ReactNode;
  /**
   * Full-bleed main area with no max width or padding, for the desk's multi-column layout. The main element becomes a
   * flex column that fills the space between the top bar and the footer. From 1024px up the frame is exactly the
   * screen's height, with a slim concept bar at its foot, so the window never scrolls: each column scrolls on its own.
   */
  fullBleed?: boolean;
  /** Keyboard shortcuts listed in the panel. Defaults to the ones that work on every page ("?" and Esc). */
  shortcuts?: ShortcutGroup[];
  /** One line under the shortcuts panel title. Defaults to "Shortcuts pause while you type." */
  shortcutsIntro?: string;
  /** Extra classes for <main>. */
  mainClassName?: string;
}

function isActive(pathname: string, href: string) {
  const p = normalizePath(pathname);
  const h = normalizePath(href);
  return p === h || p.startsWith(h + "/");
}

/** The signed-in person for the current role: the session's chosen staff member, else the role's default. */
function useSignedInPerson(info: RoleInfo): RoleInfo["user"] {
  const { staff } = useSession();
  if (!staff || staff.name === info.user.name) return info.user;
  const first = staff.name.replace(/^Dr\.?\s+/, "").split(/\s+/)[0] ?? staff.name;
  return { name: staff.name, firstName: first, title: staff.title };
}

/**
 * "Reset the demo": clears this visitor's decisions, actions and remembered settings. Undo is offered when there were
 * decisions or actions to bring back (remembered settings such as the Insights assumptions simply return to default).
 */
function useResetDemo(): () => void {
  const { resetDemo, undo, data } = useSession();
  const { toast } = useToast();
  return useCallback(() => {
    const undoable = !isPristine(data);
    const changed = resetDemo();
    if (undoable) {
      toast({
        message: "Demo reset",
        detail: "Every message is back in the queue.",
        tone: "success",
        onUndo: () => {
          undo();
        },
      });
    } else if (changed) {
      toast({ message: "Demo reset", detail: "Your settings are back to their defaults.", tone: "success" });
    } else {
      toast({ message: "Nothing to reset", detail: "The demo is already at the start." });
    }
  }, [resetDemo, undo, toast, data]);
}

/** Where focus goes when the shortcuts panel closes and the element that opened it has gone (a closed menu). */
const SHORTCUTS_RETURN = "[data-shortcuts-return]";

function isShown(el: HTMLElement): boolean {
  return el.isConnected && el.getClientRects().length > 0;
}

/**
 * The app frame: skip link, top bar (wordmark, Concept pill, primary nav ending in the "Try it" pill, Help, and the
 * signed-in person, whose menu holds "Viewing as"), main landmark, concept footer and the toast region. Below 1024px
 * the nav collapses behind a menu button.
 */
export function AppShell({ children, fullBleed, shortcuts = DEFAULT_SHORTCUTS, shortcutsIntro, mainClassName }: AppShellProps) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const [storedRole, setStoredRole] = useRole();
  const pathRole = roleForPath(pathname);
  const role = pathRole ?? storedRole;
  const roleInfo = ROLES[role];
  const shortcutsRef = useRef<HTMLDialogElement>(null);
  const shortcutsCloseRef = useRef<HTMLButtonElement>(null);
  /** The element focused before the shortcuts panel opened, to return to when it closes. */
  const shortcutsReturnRef = useRef<HTMLElement | null>(null);
  const [singleKeys, setSingleKeys] = useSingleKeys();

  // Keep the stored role in step with the area being viewed.
  useEffect(() => {
    if (pathRole && pathRole !== storedRole) setStoredRole(pathRole);
  }, [pathRole, storedRole, setStoredRole]);

  const switchRole = useCallback(
    (r: Role) => {
      setStoredRole(r);
      router.push(ROLES[r].home);
    },
    [router, setStoredRole],
  );

  const openShortcuts = useCallback(() => {
    const panel = shortcutsRef.current;
    if (!panel) return;
    if (!panel.open) {
      const active = document.activeElement;
      shortcutsReturnRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
      try {
        panel.showModal();
      } catch {
        /* already open */
      }
    }
    shortcutsCloseRef.current?.focus();
  }, []);
  const closeShortcuts = useCallback(() => {
    try {
      shortcutsRef.current?.close();
    } catch {
      /* already closed */
    }
  }, []);

  // When the panel closes (close button, Escape or a click on the backdrop), put focus back where it was, unless the
  // visitor has already moved it somewhere else on the page.
  useEffect(() => {
    const panel = shortcutsRef.current;
    if (!panel) return;
    const onClose = () => {
      const prev = shortcutsReturnRef.current;
      shortcutsReturnRef.current = null;
      const active = document.activeElement;
      if (active && active !== document.body && !panel.contains(active)) return;
      const fallback = [...document.querySelectorAll<HTMLElement>(SHORTCUTS_RETURN)].find(isShown);
      const target = prev && isShown(prev) ? prev : fallback;
      target?.focus();
    };
    panel.addEventListener("close", onClose);
    return () => panel.removeEventListener("close", onClose);
  }, []);

  const replayTour = useCallback(() => {
    const handledHere = !window.dispatchEvent(new CustomEvent(TOUR_EVENT, { cancelable: true }));
    if (!handledHere) router.push(TOUR_URL);
  }, [router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" || !singleKeys || e.defaultPrevented) return;
      if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      e.preventDefault();
      openShortcuts();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openShortcuts, singleKeys]);

  const api = useMemo(
    () => ({ role, roleInfo, switchRole, openShortcuts, replayTour, singleKeys, setSingleKeys }),
    [role, roleInfo, switchRole, openShortcuts, replayTour, singleKeys, setSingleKeys],
  );

  return (
    <ToastProvider>
      <ShellContext.Provider value={api}>
        <TourProvider>
        {/* Full-bleed screens fill the screen from 1024px up, the concept bar included, so the window itself never
            scrolls there (a second scroll would slide the page under the top bar on every Tab). On a very short
            screen the frame keeps a floor and the page scrolls instead of crushing the columns. */}
        <div className={cn("flex min-h-dvh flex-col", fullBleed && "lg:h-dvh lg:min-h-[44rem]")}>
          <a
            href="#main"
            className="sr-only rounded-control bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-[60]"
          >
            Skip to main content
          </a>

          <header className="sticky top-0 z-40 border-b border-line-cool bg-surface">
            <div className="flex h-16 items-center gap-4 px-4 sm:px-6">
              <Wordmark />

              {/* Five quiet links, then "Try it" as a small pill at the far end of the same list. The role lives in the
                  account menu on the right, so the bar carries only the nav, Help and the signed-in person. */}
              <nav aria-label="Primary" className="ml-3 hidden min-w-0 flex-1 lg:block xl:ml-6">
                <ul className="flex items-center gap-0.5 xl:gap-1">
                  {NAV_ITEMS.map((item) => {
                    const active = isActive(pathname, item.href);
                    if (isPill(item)) {
                      return (
                        <li key={item.href} className="ml-auto pl-3">
                          <Link
                            href={item.href}
                            aria-current={active ? "page" : undefined}
                            className={cn(
                              "inline-flex h-9 items-center gap-1.5 rounded-pill border px-3.5 text-sm font-medium text-heading transition-colors duration-150",
                              active
                                ? "border-transparent bg-field"
                                : "border-line-strong bg-surface hover:border-navy-300 hover:bg-field active:bg-field-hover",
                            )}
                          >
                            <PenLine aria-hidden size={14} className="text-navy-700" />
                            {item.label}
                          </Link>
                        </li>
                      );
                    }
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "inline-flex h-9 items-center rounded-inner px-2.5 text-sm transition-colors duration-150 xl:px-3",
                            active
                              ? "bg-field font-medium text-heading"
                              : "text-muted hover:bg-navy-900/[0.04] hover:text-heading active:bg-navy-900/[0.08]",
                          )}
                        >
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </nav>

              <div className="ml-1 hidden items-center gap-1 lg:flex">
                <HelpMenu onReplayTour={replayTour} onShortcuts={openShortcuts} />
                <AccountMenu info={roleInfo} role={role} onSwitch={switchRole} />
              </div>

              <div className="ml-auto lg:hidden">
                <MobileNav
                  pathname={pathname}
                  role={role}
                  onSwitch={switchRole}
                  onReplayTour={replayTour}
                  onShortcuts={openShortcuts}
                  info={roleInfo}
                />
              </div>
            </div>
          </header>

          <main
            id="main"
            tabIndex={-1}
            className={cn(
              "flex-1 focus:outline-none",
              fullBleed ? "flex min-h-0 flex-col" : "mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8",
              mainClassName,
            )}
          >
            {children}
          </main>

          <ConceptFooter slim={fullBleed} />
        </div>
        <ShortcutsPanel
          ref={shortcutsRef}
          closeButtonRef={shortcutsCloseRef}
          groups={shortcuts}
          intro={shortcutsIntro}
          onClose={closeShortcuts}
          singleKeys={singleKeys}
          onSingleKeysChange={setSingleKeys}
        />
        </TourProvider>
      </ShellContext.Provider>
    </ToastProvider>
  );
}

/**
 * The signed-in fictional person, which is also where the "Viewing as" switch lives: the role follows the page anyway
 * (the desk is the agent's, the clinician queue the clinician's, Insights the team lead's), so the switch is a shortcut
 * to another person's screen rather than a control the bar needs to show all the time.
 */
function AccountMenu({ info, role, onSwitch }: { info: RoleInfo; role: Role; onSwitch: (r: Role) => void }) {
  const user = useSignedInPerson(info);
  return (
    <Menu
      label="Signed in and viewing as"
      align="end"
      width={280}
      items={[
        { type: "label", id: "who", label: `Signed in as ${user.name}, ${user.title}` },
        { type: "separator", id: "s" },
        { type: "label", id: "l", label: "Viewing as" },
        ...ROLE_ORDER.map((r) => ({
          type: "radio" as const,
          id: r,
          label: ROLES[r].label,
          description: ROLES[r].description,
          checked: r === role,
          onSelect: () => onSwitch(r),
        })),
      ]}
      trigger={({ open, ...p }) => (
        <button
          {...p}
          type="button"
          aria-label={`${user.name}, viewing as ${ROLES[role].label}`}
          className={cn(
            "inline-flex h-11 items-center gap-2 rounded-pill py-1 pl-1 pr-2 text-left transition-colors duration-150 hover:bg-navy-900/[0.04] active:bg-navy-900/[0.08]",
            open && "bg-navy-900/[0.06]",
          )}
        >
          <Avatar name={user.name} size="md" />
          <span aria-hidden className="hidden flex-col leading-tight xl:flex">
            <span className="text-sm font-medium text-heading">{user.firstName}</span>
            <span className="text-2xs text-muted">{ROLES[role].label}</span>
          </span>
          <ChevronDown
            aria-hidden
            size={14}
            className={cn("text-muted-icon transition-transform duration-200 ease-out-expo", open && "rotate-180")}
          />
        </button>
      )}
    />
  );
}

function HelpMenu({ onReplayTour, onShortcuts }: { onReplayTour: () => void; onShortcuts: () => void }) {
  const onReset = useResetDemo();
  return (
    <Menu
      label="Help"
      align="end"
      width={248}
      items={[
        { id: "tour", label: "Replay the tour", icon: CirclePlay, description: "One minute, five steps", onSelect: onReplayTour },
        { id: "keys", label: "Keyboard shortcuts", icon: Keyboard, hint: <Kbd>?</Kbd>, onSelect: onShortcuts },
        { id: "how", label: "How it works", icon: BookOpen, href: "/how-it-works/" },
        { id: "about", label: "About me", icon: UserRound, description: "Who built Care Desk, and how to reach me", href: BUILDER_ABOUT_HREF },
        { type: "separator", id: "s" },
        {
          id: "reset",
          label: "Reset the demo",
          icon: RotateCcw,
          description: "Every message back in the queue",
          onSelect: onReset,
        },
      ]}
      trigger={({ open, ...p }) => (
        <Tooltip content="Help" describe={false}>
          <button
            {...p}
            type="button"
            aria-label="Help"
            data-shortcuts-return=""
            className={cn(
              "inline-flex size-9 items-center justify-center rounded-inner text-heading transition-colors duration-150 hover:bg-navy-900/[0.06] active:bg-navy-900/10",
              open && "bg-navy-900/[0.06]",
            )}
          >
            <CircleQuestionMark aria-hidden size={20} />
          </button>
        </Tooltip>
      )}
    />
  );
}

const MOBILE_ACTION =
  "flex h-11 items-center gap-3 rounded-control px-4 text-sm font-medium text-ink transition-colors duration-150 hover:bg-field active:bg-field-hover";

function MobileNav({
  pathname,
  role,
  onSwitch,
  onReplayTour,
  onShortcuts,
  info,
}: {
  pathname: string;
  role: Role;
  onSwitch: (r: Role) => void;
  onReplayTour: () => void;
  onShortcuts: () => void;
  info: RoleInfo;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const onReset = useResetDemo();
  const user = useSignedInPerson(info);

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const onToggle = (e: Event) => setOpen((e as ToggleEvent).newState === "open");
    // Tabbing out of the open menu closes it, so focus never lands on a control the menu still covers. Shift+Tab back
    // to the Menu button keeps it open; focus leaving the window (relatedTarget null) is not a move on the page.
    const onFocusOut = (e: FocusEvent) => {
      const next = e.relatedTarget;
      if (!(next instanceof Node) || el.contains(next) || buttonRef.current?.contains(next)) return;
      try {
        el.hidePopover();
      } catch {
        /* already closed */
      }
    };
    el.addEventListener("toggle", onToggle);
    el.addEventListener("focusout", onFocusOut);
    return () => {
      el.removeEventListener("toggle", onToggle);
      el.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  const close = () => {
    try {
      panelRef.current?.hidePopover();
    } catch {
      /* already closed */
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        popoverTarget="caredesk-mobile-nav"
        data-shortcuts-return=""
        aria-expanded={open}
        aria-controls="caredesk-mobile-nav"
        className="inline-flex h-10 items-center gap-2 rounded-control bg-field px-3 text-sm font-medium text-heading transition-colors duration-150 hover:bg-field-hover"
      >
        {open ? <X aria-hidden size={18} /> : <MenuIcon aria-hidden size={18} />}
        Menu
      </button>
      <div
        ref={panelRef}
        id="caredesk-mobile-nav"
        popover="auto"
        className="fixed inset-x-0 bottom-auto top-16 m-0 max-h-[calc(100dvh-4rem)] w-full max-w-none overflow-y-auto border-b border-line-cool bg-surface px-4 pb-6 pt-3 shadow-pop open:animate-rise-in backdrop:bg-navy-950/20 sm:px-6"
      >
        <nav aria-label="Primary">
          <ul className="flex flex-col gap-1">
            {NAV_ITEMS.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={close}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex h-12 items-center rounded-control px-4 text-base font-medium transition-colors duration-150",
                      active ? "bg-field text-heading" : "text-ink hover:bg-field/70",
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="mt-3 flex flex-col gap-0.5 border-t border-line-cool pt-3">
          <button
            type="button"
            onClick={() => {
              close();
              onReplayTour();
            }}
            className={MOBILE_ACTION}
          >
            <CirclePlay aria-hidden size={18} className="text-muted-icon" />
            Replay the tour
          </button>
          <button
            type="button"
            onClick={() => {
              close();
              onShortcuts();
            }}
            className={MOBILE_ACTION}
          >
            <Keyboard aria-hidden size={18} className="text-muted-icon" />
            Keyboard shortcuts
          </button>
          <button
            type="button"
            onClick={() => {
              close();
              onReset();
            }}
            className={MOBILE_ACTION}
          >
            <RotateCcw aria-hidden size={18} className="text-muted-icon" />
            Reset the demo
          </button>
          <Link href={BUILDER_ABOUT_HREF} onClick={close} className={MOBILE_ACTION}>
            <UserRound aria-hidden size={18} className="text-muted-icon" />
            About me
          </Link>
        </div>

        {/* Who is signed in, and the switch to another person's view, together in one block. */}
        <div className="mt-3 border-t border-line-cool pt-4">
          <div className="flex items-center gap-3 px-1">
            <Avatar name={user.name} />
            <div className="min-w-0">
              <p className="text-sm font-medium text-heading">{user.name}</p>
              <p className="text-xs text-muted">{user.title}</p>
            </div>
          </div>
          <p id="mobile-role-label" className="mb-2 mt-4 px-1 text-xs font-medium text-muted">
            Viewing as
          </p>
          <RoleRadios
            role={role}
            onSwitch={(r) => {
              close();
              onSwitch(r);
            }}
          />
        </div>
      </div>
    </>
  );
}

/**
 * The phone menu's "Viewing as" switch: one Tab stop, like every other radio group in the app. The arrow keys move
 * between the roles; Enter or Space switches, because switching takes you to that role's screen, and a new page should
 * not open just by arrowing past a choice (WCAG 3.2.2).
 */
function RoleRadios({ role, onSwitch }: { role: Role; onSwitch: (r: Role) => void }) {
  const refs = useRef(new Map<Role, HTMLButtonElement | null>());

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const current = ROLE_ORDER.find((r) => refs.current.get(r) === document.activeElement) ?? role;
    const i = ROLE_ORDER.indexOf(current);
    const last = ROLE_ORDER.length - 1;
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = i === last ? 0 : i + 1;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = i === 0 ? last : i - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    if (next === null) return;
    e.preventDefault();
    refs.current.get(ROLE_ORDER[next])?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-labelledby="mobile-role-label"
      onKeyDown={onKeyDown}
      className="grid grid-cols-3 gap-1 rounded-control bg-field p-1"
    >
      {ROLE_ORDER.map((r) => (
        <button
          key={r}
          ref={(el) => {
            refs.current.set(r, el);
          }}
          type="button"
          role="radio"
          aria-checked={r === role}
          tabIndex={r === role ? 0 : -1}
          onClick={() => onSwitch(r)}
          className={cn(
            "h-10 rounded-inner text-sm font-medium transition-colors duration-150 active:bg-white/80",
            r === role ? "bg-surface text-heading shadow-card" : "text-muted hover:bg-white/60 hover:text-heading",
          )}
        >
          {ROLES[r].label}
        </button>
      ))}
    </div>
  );
}
