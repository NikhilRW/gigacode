import { Text, View } from 'react-native';
import { useAuth } from '@/state/AuthProvider';
import { useDrafts } from '@/state/DraftProvider';
import { useTheme } from '@/state/ThemeProvider';
import { mono, radius } from '@/theme';
import { Card, Field, FlowRow } from './AppScreen';
import { Button, Icon, SettingToggle } from './ui';

export function RunSettings() {
  const { me } = useAuth();
  const { library, configure, ready } = useDrafts();
  const { common } = useTheme();
  const maxTime = Math.min(me?.limits.maxTimeoutMs ?? 10000, 10000);
  const maxMemory = Math.min(me?.limits.maxMemoryMb ?? 512, 512);
  const entry = library.files.find((file) => file.id === library.entries[library.language]);
  return (
    <Card title="Run settings">
      <Text style={common.muted}>
        Entry: {entry?.name ?? 'Select an entry file'} · settings apply to the next run and are saved on this
        device.
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
        <LimitControl
          label="Time limit"
          icon="clock"
          value={Math.max(100, Math.min(library.timeoutMs, maxTime))}
          min={100}
          max={maxTime}
          step={500}
          format={(value) => `${(value / 1000).toFixed(value % 1000 ? 1 : 0)} s`}
          presets={[1000, 2000, 5000, maxTime]}
          onChange={(timeoutMs) => configure({ timeoutMs })}
          disabled={!ready}
        />
        <LimitControl
          label="Memory limit"
          icon="hard-drive"
          value={Math.max(16, Math.min(library.memoryMb, maxMemory))}
          min={16}
          max={maxMemory}
          step={16}
          format={(value) => `${value} MiB`}
          presets={[64, 128, 256, maxMemory]}
          onChange={(memoryMb) => configure({ memoryMb })}
          disabled={!ready}
        />
      </View>
      <SettingToggle
        label="Advanced run settings"
        description="Adjust CPU allowance and the process/thread limit."
        value={library.advancedSettings}
        disabled={!ready}
        onValueChange={(advancedSettings) => configure({ advancedSettings })}
      />
      {library.advancedSettings && (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
            <LimitControl
              label="CPU allowance"
              icon="cpu"
              value={library.cpuMsPerSec}
              min={100}
              max={1000}
              step={100}
              format={(value) => `${value / 10}% of 1 core`}
              presets={[250, 500, 750, 1000]}
              onChange={(cpuMsPerSec) => configure({ cpuMsPerSec })}
              disabled={!ready}
            />
            <LimitControl
              label="Processes / threads"
              icon="layers"
              value={library.pids}
              min={1}
              max={64}
              step={8}
              format={(value) => `${value} maximum`}
              presets={[8, 16, 32, 64]}
              onChange={(pids) => configure({ pids })}
              disabled={!ready}
            />
          </View>
          <Text style={common.muted}>
            100% allows up to one core’s CPU time. A lower quota throttles the program; it does not change its
            wall-time limit. The process limit also counts runtime threads, so low values can prevent a
            runtime from starting.
          </Text>
          <Button
            label="Reset run limits"
            disabled={!ready}
            onPress={() =>
              configure({
                timeoutMs: Math.min(5000, maxTime),
                memoryMb: Math.min(256, maxMemory),
                cpuMsPerSec: 1000,
                pids: 64,
              })
            }
          />
        </>
      )}
      <SettingToggle
        label="Show resource usage"
        description="Display per-run CPU, memory, timing, and output measurements."
        value={library.showUsage}
        disabled={!ready}
        onValueChange={(showUsage) => configure({ showUsage })}
      />
      <SettingToggle
        label={`Program internet access · ${library.network ? 'On' : 'Off'}`}
        value={library.network}
        disabled={!ready}
        onValueChange={(network) => configure({ network })}
        description="Enable outbound public TCP/UDP and DNS for the next run. Off blocks sockets. Private/local destinations remain blocked; this does not change the app’s own connection."
      />
      <Field
        label="Standard input"
        multiline
        value={library.stdin}
        onChangeText={(stdin) => configure({ stdin })}
        editable={ready}
        style={{ minHeight: 110, textAlignVertical: 'top', fontFamily: mono }}
        placeholder="Input your program reads from stdin (up to 256 KiB)"
      />
    </Card>
  );
}

function LimitControl({
  label,
  icon,
  value,
  min,
  max,
  step,
  format,
  presets,
  onChange,
  disabled,
}: {
  label: string;
  icon: 'clock' | 'hard-drive' | 'cpu' | 'layers';
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  presets: number[];
  onChange: (value: number) => void;
  disabled: boolean;
}) {
  const { colors, common } = useTheme();
  const choices = [...new Set(presets.filter((preset) => preset >= min && preset <= max))];
  return (
    <View
      style={{
        flexGrow: 1,
        flexBasis: 240,
        minWidth: 0,
        gap: 12,
        padding: 16,
        borderRadius: radius,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.raised,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name={icon} color={colors.accent} />
        <Text style={common.text}>{label}</Text>
      </View>
      <Text accessibilityLiveRegion="polite" style={[common.text, { fontFamily: mono, fontSize: 20 }]}>
        {format(value)}
      </Text>
      <FlowRow>
        <Button
          label="−"
          accessibilityLabel={`Decrease ${label}`}
          disabled={disabled || value <= min}
          onPress={() => onChange(Math.max(min, value - step))}
          compact
        />
        <Button
          label="+"
          accessibilityLabel={`Increase ${label}`}
          disabled={disabled || value >= max}
          onPress={() => onChange(Math.min(max, value + step))}
          compact
        />
        <Text style={common.muted}>Max {format(max)}</Text>
      </FlowRow>
      <FlowRow>
        {choices.map((preset) => (
          <Button
            key={preset}
            label={format(preset)}
            variant={value === preset ? 'primary' : 'secondary'}
            disabled={disabled}
            compact
            onPress={() => onChange(preset)}
          />
        ))}
      </FlowRow>
    </View>
  );
}
