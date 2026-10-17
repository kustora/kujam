// BOARD-106: lint fixture. Importing the outermost layers; invalid for any package below them.
import { Board as ReactBoard } from '@kujam/react';
import { Board as VueBoard } from '@kujam/vue';
import { mountToolbar } from '@kujam/ui/toolbar';
import { exportPng } from '@kujam/export';

export const outer = [ReactBoard, VueBoard, mountToolbar, exportPng];
