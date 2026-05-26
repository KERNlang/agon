// @kern-source: composer:12
import React from 'react';

// @kern-source: composer:13
import { Box, Text } from 'ink';

// @kern-source: composer:14
import { PromptTextInput } from '../../generated/blocks/prompt-input.js';

// @kern-source: composer:15
import { SlashPicker } from '../../generated/blocks/controls.js';

// @kern-source: composer:16
import { icons } from '../signals/icons.js';

// @kern-source: composer:17
import { getGhostCompletion } from '../../ghost-text.js';

// @kern-source: composer:18
import { truncateCodeLine } from './markdown.js';

// @kern-source: composer:20

export function ComposerView({ mode, replState, planModeQueued, autoModeQueued, activePlanState, slashPickerOpen, inputValue, handleInputChange, handlePasteInput, handleSubmit, allSlashCommands, availableEngines, onSlashSelect, onSlashCancel, questionState, questionAnswer, onQuestionAnswerChange, onQuestionAnswerSubmit, onCtrlShortcut, termWidth, termHeight }: { mode: 'chat'|'campfire'|'brainstorm'|'tribunal'; replState: string; planModeQueued: boolean; autoModeQueued: boolean; activePlanState: string|null; slashPickerOpen: boolean; inputValue: string; handleInputChange: (value:string) => void; handlePasteInput: (raw:string) => string; handleSubmit: (value:string) => void; allSlashCommands: any[]; availableEngines: string[]; onSlashSelect: (cmd:string) => void; onSlashCancel: () => void; questionState: any; questionAnswer: string; onQuestionAnswerChange: (value:string) => void; onQuestionAnswerSubmit: (value:string) => void; onCtrlShortcut: (shortcut:string) => void; termWidth: number; termHeight: number }) {
        const placeholder = replState === 'idle'
          ? (mode === 'chat'
              ? ''
              : mode === 'campfire'
                ? 'What should we think about?'
                : mode === 'brainstorm'
                  ? 'What question for the engines?'
                  : 'What should they debate?')
          : '';
        const ghost = getGhostCompletion(inputValue, allSlashCommands, availableEngines);
        const promptWidth = Math.max(12, termWidth - (mode === 'chat' ? 10 : 22));
        const promptMaxLines = Math.max(3, Math.min(8, Math.floor(termHeight / 4)));
        const choiceList = Array.isArray(questionState?.choices)
          ? questionState.choices as {key:string,label:string,color?:string}[]
          : [];
        const questionPrompt = typeof questionState?.prompt === 'string'
          ? questionState.prompt.trim()
          : questionState?.prompt;
        const isPermissionQuestion = questionState?.kind === 'permission';
        const permissionTool = typeof questionState?.tool === 'string'
          ? questionState.tool
          : 'Command';
        const permissionCommand = typeof questionState?.command === 'string'
          ? questionState.command
          : '';
        const permissionDescription = typeof questionState?.description === 'string'
          ? questionState.description.trim()
          : '';
        const permissionReason = typeof questionState?.reason === 'string'
          ? questionState.reason.trim()
          : '';
        const permissionLinesAll = permissionCommand ? permissionCommand.split('\n') : [];
        const permissionLineWidth = Math.max(24, termWidth - 24);
        const permissionPreview = permissionLinesAll[0]
          ? truncateCodeLine(permissionLinesAll[0], permissionLineWidth)
          : '';
        const permissionHasMoreLines = permissionLinesAll.length > 1;
        const permissionNeedsDetail = permissionHasMoreLines || permissionCommand.length > permissionLineWidth;
        const permissionSummary = permissionReason || permissionDescription;
        const yesChoice = choiceList.find((choice: any) => String(choice.key ?? '').toLowerCase() === 'y');
        const noChoice = choiceList.find((choice: any) => String(choice.key ?? '').toLowerCase() === 'n');
        const alwaysChoice = choiceList.find((choice: any) => String(choice.key ?? '').toLowerCase() === 'a');
        const fmtChoiceKey = (choice: any, idx: number) => {
          const key = String(choice?.key ?? '').toUpperCase();
          if (/^[1-9]$/.test(key)) return key;
          return idx < 9 ? `${key}/${idx + 1}` : key;
        };
        const inlineChoiceText = choiceList.map((choice: any, i: number) => {
          const label = String(choice?.label ?? '').trim();
          return `[${fmtChoiceKey(choice, i)}] ${label}`.trim();
        }).join('  ');
        // Only yes/no-style (2 choices) render inline/horizontal. Three or more —
        // i.e. a real options menu / fork — always stacks vertically, one per line.
        const useInlineChoices = choiceList.length > 0
          && choiceList.length <= 2
          && inlineChoiceText.length <= Math.max(24, termWidth - 10);
        const questionAccent = choiceList.length > 0 ? '#60a5fa' : '#d1d5db';
        return (
          <>
            {slashPickerOpen && <SlashPicker commands={allSlashCommands} onSelect={onSlashSelect} onCancel={onSlashCancel} />}
            {!questionState && (
              <Box borderStyle={mode === 'chat' ? 'round' : 'single'} borderColor={mode === 'chat' ? '#585858' : 'gray'} borderLeft={mode !== 'chat'} borderRight={mode !== 'chat'} borderTop borderBottom paddingX={1} width="100%">
                {mode !== 'chat' && (<Text><Text color={mode === 'campfire' ? '#f97316' : mode === 'brainstorm' ? '#22d3ee' : '#a78bfa'} bold>{mode === 'campfire' ? icons().campfire : mode === 'brainstorm' ? icons().brainstorm : icons().tribunal}{' '}{mode}</Text><Text dimColor>{' \u2502 '}</Text></Text>)}
                <Text color={mode === 'chat' ? (planModeQueued || autoModeQueued || activePlanState === 'planning' ? '#c084fc' : '#585858') : '#fbbf24'}>{mode === 'chat' ? (planModeQueued ? '\u25c8 ' : autoModeQueued ? '\u25b6 ' : '> ') : icons().prompt + ' '}</Text>
                <Box flexGrow={1}>
                  {slashPickerOpen ? (
                    <Text dimColor>{inputValue || '/'}</Text>
                  ) : (
                    <PromptTextInput
                      value={inputValue}
                      onChange={handleInputChange}
                      onPaste={handlePasteInput}
                      onSubmit={handleSubmit}
                      onCtrlShortcut={onCtrlShortcut}
                      placeholder={placeholder}
                      focus={true}
                      showCursor={true}
                      highlightPastedText={true}
                      ghostText={ghost ?? undefined}
                      width={promptWidth}
                      maxVisibleLines={promptMaxLines} />
                  )}
                </Box>
              </Box>
            )}
            {questionState && (
              isPermissionQuestion ? (
                <Box flexDirection="column" width="100%" marginTop={1}>
                  <Box borderStyle="round" borderColor="#fbbf24" paddingX={1} flexDirection="column" width="100%">
                    <Text bold color="#fbbf24">{icons().warning}{' '}{permissionTool}{' approval required'}</Text>
                    <Text>
                      {yesChoice ? <Text color={yesChoice.color ?? '#4ade80'} bold>{'['}{fmtChoiceKey(yesChoice, choiceList.indexOf(yesChoice))}{'] '}{yesChoice.label}</Text> : null}
                      {yesChoice && (noChoice || alwaysChoice || permissionNeedsDetail) ? <Text dimColor>{'  '}</Text> : null}
                      {noChoice ? <Text color={noChoice.color ?? '#ef4444'} bold>{'['}{fmtChoiceKey(noChoice, choiceList.indexOf(noChoice))}{'] '}{noChoice.label}</Text> : null}
                      {noChoice && (alwaysChoice || permissionNeedsDetail) ? <Text dimColor>{'  '}</Text> : null}
                      {alwaysChoice ? <Text color={alwaysChoice.color ?? '#60a5fa'} bold>{'['}{fmtChoiceKey(alwaysChoice, choiceList.indexOf(alwaysChoice))}{'] '}{alwaysChoice.label}</Text> : null}
                    </Text>
                    {permissionPreview ? (
                      <Text dimColor>{'  $ '}{permissionPreview}{permissionHasMoreLines ? ' …' : ''}</Text>
                    ) : questionPrompt ? (
                      <Text dimColor>{'  '}{questionPrompt}</Text>
                    ) : null}
                    {permissionSummary ? <Text dimColor>{'  '}{truncateCodeLine(permissionSummary, Math.max(24, termWidth - 10))}</Text> : null}
                    <Text dimColor>{'  Esc cancels the prompt.'}</Text>
                  </Box>
                </Box>
              ) : (
                <Box flexDirection="column" width="100%" marginTop={1}>
                  <Box borderStyle="round" borderColor={choiceList.length > 0 ? questionAccent : '#585858'} paddingX={1} flexDirection="column" width="100%">
                    <Text bold color={questionAccent}>{choiceList.length > 0 ? '? ' : ' '}{questionPrompt}</Text>
                    {choiceList.length > 0 ? (
                      useInlineChoices ? (
                        <Box paddingLeft={1}>
                          <Text>
                            {choiceList.map((c: any, i: number) => (
                              <React.Fragment key={`choice-inline-${i}`}>
                                {i > 0 ? <Text dimColor>{'  '}</Text> : null}
                                <Text color={c.color ?? questionAccent} bold>{'['}{fmtChoiceKey(c, i)}{'] '}{c.label}</Text>
                              </React.Fragment>
                            ))}
                          </Text>
                        </Box>
                      ) : (
                        <Box flexDirection="column" paddingLeft={1}>
                          {choiceList.map((c: any, i: number) => (
                            <Text key={`choice-${i}`}>
                              <Text color={c.color ?? questionAccent} bold>{'['}{fmtChoiceKey(c, i)}{']'}</Text>
                              <Text>{' '}{c.label}</Text>
                            </Text>
                          ))}
                        </Box>
                      )
                    ) : (
                      <Box paddingLeft={1} width="100%">
                        <PromptTextInput
                          value={questionAnswer}
                          onChange={onQuestionAnswerChange}
                          onPaste={undefined}
                          onSubmit={onQuestionAnswerSubmit}
                          onCtrlShortcut={onCtrlShortcut}
                          placeholder=""
                          focus={true}
                          showCursor={true}
                          highlightPastedText={true}
                          ghostText={undefined}
                          width={Math.max(12, termWidth - 10)}
                          maxVisibleLines={Math.max(2, Math.min(4, promptMaxLines))} />
                      </Box>
                    )}
                  </Box>
                </Box>
              )
            )}
          </>
        );
}


