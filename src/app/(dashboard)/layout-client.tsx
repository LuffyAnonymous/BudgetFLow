"use client";

import { useState } from "react";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppHeader } from "@/components/layout/app-header";
import { clsx } from "clsx";

interface DashboardLayoutClientProps {
  children: React.ReactNode;
  userName?: string | null;
  userEmail?: string | null;
}

export function DashboardLayoutClient({
  children,
  userName,
  userEmail,
}: DashboardLayoutClientProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen((prev) => !prev);
  };

  const closeMobileMenu = () => {
    setIsMobileMenuOpen(false);
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 text-slate-100">
      {/* Skip to main content — visible only on keyboard focus */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:rounded-xl focus:bg-indigo-600 focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-white focus:shadow-lg focus:outline-none"
      >
        Skip to main content
      </a>

      {/* Backdrop for Mobile Sidebar Drawer */}
      {isMobileMenuOpen && (
        <div
          onClick={closeMobileMenu}
          aria-hidden="true"
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs transition-opacity duration-300 lg:hidden"
        />
      )}

      {/* Sidebar - Desktop and Mobile (Drawer) */}
      <div
        role="navigation"
        aria-label="Main navigation"
        className={clsx(
          "fixed inset-y-0 left-0 z-50 transform transition-transform duration-300 ease-in-out lg:static lg:translate-x-0",
          isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <AppSidebar
          userName={userName}
          userEmail={userEmail}
          onCloseMobile={closeMobileMenu}
        />
      </div>

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col overflow-hidden bg-slate-900 lg:bg-slate-950">
        <header role="banner">
          <AppHeader onMenuToggle={toggleMobileMenu} />
        </header>

        {/* Scrollable Children Container */}
        <main id="main-content" className="flex-1 overflow-y-auto px-6 py-8 md:px-8" tabIndex={-1}>
          <div className="mx-auto max-w-7xl">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
