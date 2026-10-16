// BOARD-106: fixture lint. Impor lapisan paling luar; tidak sah untuk package mana pun di bawahnya.
import { Board as ReactBoard } from '@kujam/react';
import { Board as VueBoard } from '@kujam/vue';
import { mountToolbar } from '@kujam/ui/toolbar';
import { exportPng } from '@kujam/export';

export const outer = [ReactBoard, VueBoard, mountToolbar, exportPng];
