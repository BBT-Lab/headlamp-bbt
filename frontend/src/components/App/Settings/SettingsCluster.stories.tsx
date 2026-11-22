/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// 文件描述：展示和验证集群设置界面的交互。
// 项目名称：Headlamp BBT
// 文件名称：SettingsCluster.stories.tsx
// 作者：Codex
// 日期：2026-11-23

import { configureStore } from '@reduxjs/toolkit';
import { Meta, StoryFn } from '@storybook/react';
import { screen, within } from '@testing-library/react';
import React from 'react';
import { expect, userEvent, waitFor } from 'storybook/test';
import i18next from '../../../i18n/config';
import { TestContext } from '../../../test';
import SettingsCluster from './SettingsCluster';

const mockClusterName = 'my-cluster';

function setupLocalStorage(clusterName: string, settings: Record<string, any> = {}) {
  localStorage.setItem(`cluster_settings.${clusterName}`, JSON.stringify(settings));
}

function getMockStore(clusters: Record<string, any> = {}) {
  return configureStore({
    reducer: {
      config: (
        state = {
          clusters,
          statelessClusters: {},
          allClusters: clusters,
          settings: {
            tableRowsPerPageOptions: [15, 25, 50],
            timezone: 'UTC',
            useEvict: true,
          },
        }
      ) => state,
      plugins: (state = { loaded: true }) => state,
      theme: (
        state = {
          name: 'light',
          logo: null,
          palette: { navbar: { background: '#fff' } },
        }
      ) => state,
      ui: (state = {}) => state,
      filter: (
        state = {
          namespaces: new Set(),
          search: '',
        }
      ) => state,
      resourceTable: (state = {}) => state,
      actionButtons: (state = []) => state,
      detailsViewSection: (state = {}) => state,
      routes: (state = { routes: {} }) => state,
      notifications: (state = { notifications: [] }) => state,
    },
  });
}

const mockClusters: Record<string, any> = {
  [mockClusterName]: {
    name: mockClusterName,
    auth_type: '',
    meta_data: {
      namespace: 'default',
      source: 'kubeconfig',
    },
  },
  'staging-cluster': {
    name: 'staging-cluster',
    auth_type: '',
    meta_data: {
      namespace: 'default',
      source: 'kubeconfig',
    },
  },
};

export default {
  title: 'Settings/SettingsCluster',
  component: SettingsCluster,
} as Meta<typeof SettingsCluster>;

/**
 * Default cluster settings form with a selected cluster.
 */
export const Default: StoryFn = () => {
  setupLocalStorage(mockClusterName, {
    defaultNamespace: '',
    allowedNamespaces: [],
  });

  return (
    <TestContext store={getMockStore(mockClusters)} urlSearchParams={{ c: mockClusterName }}>
      <SettingsCluster />
    </TestContext>
  );
};

/**
 * Cluster settings form pre-populated with saved settings (allowed namespaces, default namespace).
 */
export const WithSavedSettings: StoryFn = () => {
  setupLocalStorage(mockClusterName, {
    defaultNamespace: 'my-app',
    allowedNamespaces: ['default', 'kube-system', 'my-app'],
    nodeShellTerminal: {
      isEnabled: true,
      namespace: 'kube-system',
      linuxImage: 'busybox:1.28',
    },
    podDebugTerminal: {
      isEnabled: true,
      debugImage: 'docker.io/library/busybox:latest',
    },
    appearance: {
      accentColor: '#1976d2',
      icon: 'mdi:kubernetes',
    },
  });

  return (
    <TestContext store={getMockStore(mockClusters)} urlSearchParams={{ c: mockClusterName }}>
      <SettingsCluster />
    </TestContext>
  );
};

/**
 * No clusters configured — shows empty state message.
 */
export const NoClusters: StoryFn = () => {
  return (
    <TestContext store={getMockStore({})} urlSearchParams={{ c: 'nonexistent' }}>
      <SettingsCluster />
    </TestContext>
  );
};

/**
 * Selected cluster does not exist — shows error with cluster selector.
 */
export const InvalidCluster: StoryFn = () => {
  return (
    <TestContext store={getMockStore(mockClusters)} urlSearchParams={{ c: 'nonexistent-cluster' }}>
      <SettingsCluster />
    </TestContext>
  );
};

/**
 * Cluster settings showing namespace validation errors.
 * Demonstrates validation errors for invalid namespace formats (uppercase letters,
 * special characters not allowed per DNS-1123 label requirements).
 */
export const NamespaceValidation: StoryFn = () => {
  // Set up with invalid namespace values to trigger validation errors at mount
  setupLocalStorage(mockClusterName, {
    defaultNamespace: 'Invalid-Namespace', // Invalid: contains uppercase
    allowedNamespaces: ['valid-ns', 'Another-Invalid'], // Mix of valid and invalid
  });

  return (
    <TestContext store={getMockStore(mockClusters)} urlSearchParams={{ c: mockClusterName }}>
      <SettingsCluster />
    </TestContext>
  );
};

/**
 * Cluster settings with appearance customization (accent color and icon set).
 */
export const WithAppearance: StoryFn = () => {
  setupLocalStorage(mockClusterName, {
    defaultNamespace: '',
    allowedNamespaces: [],
    appearance: {
      accentColor: '#e91e63',
      icon: 'mdi:cloud-outline',
    },
  });

  return (
    <TestContext store={getMockStore(mockClusters)} urlSearchParams={{ c: mockClusterName }}>
      <SettingsCluster />
    </TestContext>
  );
};

/**
 * Dynamic cluster (removable) — would show remove button in Electron.
 */
export const DynamicCluster: StoryFn = () => {
  const dynamicClusters = {
    [mockClusterName]: {
      name: mockClusterName,
      auth_type: '',
      meta_data: {
        namespace: 'default',
        source: 'dynamic_cluster',
      },
    },
  };

  setupLocalStorage(mockClusterName, {
    defaultNamespace: 'production',
    allowedNamespaces: ['production', 'staging'],
  });

  return (
    <TestContext store={getMockStore(dynamicClusters)} urlSearchParams={{ c: mockClusterName }}>
      <SettingsCluster />
    </TestContext>
  );
};

/**
 * Multiple allowed namespaces displayed as chips.
 */
export const MultipleAllowedNamespaces: StoryFn = () => {
  setupLocalStorage(mockClusterName, {
    defaultNamespace: 'default',
    allowedNamespaces: [
      'default',
      'kube-system',
      'monitoring',
      'logging',
      'ingress-nginx',
      'cert-manager',
    ],
  });

  return (
    <TestContext store={getMockStore(mockClusters)} urlSearchParams={{ c: mockClusterName }}>
      <SettingsCluster />
    </TestContext>
  );
};

/**
 * Demonstrates the ColorPicker custom color validation.
 * The play function opens the color picker, enables custom color input,
 * types an invalid color value, and shows the inline validation error.
 */
export const ColorPickerValidation: StoryFn = () => {
  setupLocalStorage(mockClusterName, {
    defaultNamespace: '',
    allowedNamespaces: [],
  });

  return (
    <TestContext store={getMockStore(mockClusters)} urlSearchParams={{ c: mockClusterName }}>
      <SettingsCluster />
    </TestContext>
  );
};

ColorPickerValidation.play = async () => {
  const chooseColorButton = await screen.findByRole('button', {
    name: name => name.endsWith(i18next.t('translation|Choose Color')),
  });
  await userEvent.click(chooseColorButton);

  const dialog = within(await screen.findByRole('dialog'));
  const customCheckbox = await dialog.findByRole('checkbox', {
    name: name => name === i18next.t('translation|Use custom color'),
  });
  await userEvent.click(customCheckbox);

  const customInput = await dialog.findByRole('textbox', {
    name: name => name === i18next.t('translation|Custom color'),
  });
  await userEvent.type(customInput, 'not-a-color');

  await waitFor(() => {
    expect(customInput).toHaveAttribute('aria-invalid', 'true');
  });
};

ColorPickerValidation.parameters = {
  storyshots: {
    disable: true, // Disable snapshots as error appears after interaction
  },
  docs: {
    description: {
      story:
        'The play function opens the color picker, enables custom color input, and types an invalid value. ' +
        'The text field shows error styling and the Apply button remains disabled until a valid color ' +
        '(hex, rgb(), or rgba()) is entered.',
    },
  },
};
