import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Snippet } from "svelte";
import type { TransitionConfig } from "svelte/transition";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export type WithoutChildren<T> = T extends { children?: any }
	? Omit<T, "children">
	: T;

export type WithoutChildrenOrChild<T> = T extends { children?: any; child?: any }
	? Omit<T, "children" | "child">
	: T;

export type WithoutChild<T> = T extends { child?: any }
	? Omit<T, "child">
	: T;

export type WithElementRef<T> = T & { ref?: HTMLElement | null };

export type TransitionProps = {
	transition?: (node: Element, params?: any) => TransitionConfig;
	transitionConfig?: any;
};
