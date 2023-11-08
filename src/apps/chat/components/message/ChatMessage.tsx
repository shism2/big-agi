import * as React from 'react';
import TimeAgo from 'react-timeago';
import { shallow } from 'zustand/shallow';
import { cleanupEfficiency, Diff as TextDiff, makeDiff } from '@sanity/diff-match-patch';

import { Avatar, Box, Button, CircularProgress, IconButton, ListDivider, ListItem, ListItemDecorator, MenuItem, Stack, Tooltip, Typography, useTheme } from '@mui/joy';
import { SxProps } from '@mui/joy/styles/types';
import ClearIcon from '@mui/icons-material/Clear';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import EditIcon from '@mui/icons-material/Edit';
import Face6Icon from '@mui/icons-material/Face6';
import FastForwardIcon from '@mui/icons-material/FastForward';
import FormatPaintIcon from '@mui/icons-material/FormatPaint';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import PaletteOutlinedIcon from '@mui/icons-material/PaletteOutlined';
import RecordVoiceOverIcon from '@mui/icons-material/RecordVoiceOver';
import ReplayIcon from '@mui/icons-material/Replay';
import SettingsSuggestIcon from '@mui/icons-material/SettingsSuggest';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';

import { canUseElevenLabs, speakText } from '~/modules/elevenlabs/elevenlabs.client';
import { canUseProdia } from '~/modules/prodia/prodia.client';

import { CloseableMenu } from '~/common/components/CloseableMenu';
import { DMessage } from '~/common/state/store-chats';
import { InlineError } from '~/common/components/InlineError';
import { InlineTextarea } from '~/common/components/InlineTextarea';
import { KeyStroke } from '~/common/components/KeyStroke';
import { Link } from '~/common/components/Link';
import { SystemPurposeId, SystemPurposes } from '../../../../data';
import { copyToClipboard } from '~/common/util/copyToClipboard';
import { cssRainbowColorKeyframes, hideOnMobile } from '~/common/theme';
import { prettyBaseModel } from '~/common/util/modelUtils';
import { useUIPreferencesStore } from '~/common/state/store-ui';

import { RenderCode } from './RenderCode';
import { RenderHtml } from './RenderHtml';
import { RenderImage } from './RenderImage';
import { RenderLatex } from './RenderLatex';
import { RenderMarkdown } from './RenderMarkdown';
import { RenderText } from './RenderText';
import { RenderTextDiff } from './RenderTextDiff';
import { parseBlocks } from './blocks';


// Enable the hover button to copy the whole message. The Copy button is also available in Blocks, or in the Avatar Menu.
const ENABLE_COPY_MESSAGE: boolean = false;


export function messageBackground(messageRole: DMessage['role'] | string, wasEdited: boolean, unknownAssistantIssue: boolean): string {
  switch (messageRole) {
    case 'user':
      return 'primary.plainHoverBg'; // was .background.level1
    case 'assistant':
      return unknownAssistantIssue ? 'danger.softBg' : 'background.surface';
    case 'system':
      return wasEdited ? 'warning.softHoverBg' : 'background.surface';
    default:
      return '#ff0000';
  }
}

export function makeAvatar(messageAvatar: string | null, messageRole: DMessage['role'] | string, messageOriginLLM: string | undefined, messagePurposeId: SystemPurposeId | undefined, messageSender: string, messageTyping: boolean, size: 'sm' | undefined = undefined): React.JSX.Element {
  if (typeof messageAvatar === 'string' && messageAvatar)
    return <Avatar alt={messageSender} src={messageAvatar} />;
  const iconSx = { width: 40, height: 40 };
  const mascotSx = size === 'sm' ? { width: 40, height: 40 } : { width: 64, height: 64 };
  switch (messageRole) {
    case 'system':
      return <SettingsSuggestIcon sx={iconSx} />;  // https://em-content.zobj.net/thumbs/120/apple/325/robot_1f916.png

    case 'assistant':
      // display a gif avatar when the assistant is typing (people seem to love this, so keeping it after april fools')
      if (messageTyping) {
        return <Avatar
          alt={messageSender} variant='plain'
          src={messageOriginLLM === 'prodia'
            ? 'https://i.giphy.com/media/5t9ujj9cMisyVjUZ0m/giphy.webp'
            : messageOriginLLM?.startsWith('react-')
              ? 'https://i.giphy.com/media/l44QzsOLXxcrigdgI/giphy.webp'
              : 'https://i.giphy.com/media/jJxaUysjzO9ri/giphy.webp'}
          sx={{ ...mascotSx, borderRadius: 'var(--joy-radius-sm)' }}
        />;
      }
      // display the purpose symbol
      if (messageOriginLLM === 'prodia')
        return <PaletteOutlinedIcon sx={iconSx} />;
      const symbol = SystemPurposes[messagePurposeId as SystemPurposeId]?.symbol;
      if (symbol)
        return <Box
          sx={{
            fontSize: '24px',
            textAlign: 'center',
            width: '100%', minWidth: `${iconSx.width}px`, lineHeight: `${iconSx.height}px`,
          }}
        >
          {symbol}
        </Box>;
      // default assistant avatar
      return <SmartToyOutlinedIcon sx={iconSx} />; // https://mui.com/static/images/avatar/2.jpg

    case 'user':
      return <Face6Icon sx={iconSx} />;            // https://www.svgrepo.com/show/306500/openai.svg
  }
  return <Avatar alt={messageSender} />;
}

function explainErrorInMessage(text: string, isAssistant: boolean, modelId?: string) {
  const isAssistantError = isAssistant && (text.startsWith('[Issue] ') || text.startsWith('[OpenAI Issue]'));
  let errorMessage: React.JSX.Element | null = null;
  if (!isAssistantError)
    return { errorMessage, isAssistantError };

  // [OpenAI] "Service Temporarily Unavailable (503)", {"code":503,"message":"Service Unavailable.","param":null,"type":"cf_service_unavailable"}
  if (text.includes('"cf_service_unavailable"')) {
    errorMessage = <>
      The OpenAI servers appear to be having trouble at the moment. Kindly follow
      the <Link noLinkStyle href='https://status.openai.com/' target='_blank'>OpenAI Status</Link> page
      for up to date information, and at your option try again.
    </>;
  }
  // ...
  else if (text.startsWith('OpenAI API error: 429 Too Many Requests')) {
    // TODO: retry at the api/chat level a few times instead of showing this error
    errorMessage = <>
      The model appears to be occupied at the moment. Kindly select <b>GPT-3.5 Turbo</b>,
      or give it another go by selecting <b>Run again</b> from the message menu.
    </>;
  } else if (text.includes('"model_not_found"')) {
    // note that "model_not_found" is different than "The model `gpt-xyz` does not exist" message
    errorMessage = <>
      The API key appears to be unauthorized for {modelId || 'this model'}. You can change to <b>GPT-3.5
      Turbo</b> and simultaneously <Link noLinkStyle href='https://openai.com/waitlist/gpt-4-api' target='_blank'>request
      access</Link> to the desired model.
    </>;
  } else if (text.includes('"context_length_exceeded"')) {
    // TODO: propose to summarize or split the input?
    const pattern = /maximum context length is (\d+) tokens.+you requested (\d+) tokens/;
    const match = pattern.exec(text);
    const usedText = match ? <b>{parseInt(match[2] || '0').toLocaleString()} tokens &gt; {parseInt(match[1] || '0').toLocaleString()}</b> : '';
    errorMessage = <>
      This thread <b>surpasses the maximum size</b> allowed for {modelId || 'this model'}. {usedText}.
      Please consider removing some earlier messages from the conversation, start a new conversation,
      choose a model with larger context, or submit a shorter new message.
    </>;
  }
  // [OpenAI] {"error":{"message":"Incorrect API key provided: ...","type":"invalid_request_error","param":null,"code":"invalid_api_key"}}
  else if (text.includes('"invalid_api_key"')) {
    errorMessage = <>
      The API key appears to be incorrect or to have expired.
      Please <Link noLinkStyle href='https://platform.openai.com/account/api-keys' target='_blank'>check your
      API key</Link> and update it in <b>Models</b>.
    </>;
  } else if (text.includes('"insufficient_quota"')) {
    errorMessage = <>
      The API key appears to have <b>insufficient quota</b>. Please
      check <Link noLinkStyle href='https://platform.openai.com/account/usage' target='_blank'>your usage</Link> and
      make sure the usage is under <Link noLinkStyle href='https://platform.openai.com/account/billing/limits' target='_blank'>the limits</Link>.
    </>;
  }

  return { errorMessage, isAssistantError };
}

/**
 * The Message component is a customizable chat message UI component that supports
 * different roles (user, assistant, and system), text editing, syntax highlighting,
 * and code execution using Sandpack for TypeScript, JavaScript, and HTML code blocks.
 * The component also provides options for copying code to clipboard and expanding
 * or collapsing long user messages.
 *
 */
export function ChatMessage(props: { message: DMessage, diffText?: string, showDate?: boolean, isBottom?: boolean, noBottomBorder?: boolean, onMessageDelete?: () => void, onMessageEdit: (text: string) => void, onMessageRunFrom?: (offset: number) => void, onImagine?: (messageText: string) => void }) {
  const {
    text: messageText,
    sender: messageSender,
    avatar: messageAvatar,
    typing: messageTyping,
    role: messageRole,
    purposeId: messagePurposeId,
    originLLM: messageOriginLLM,
    created: messageCreated,
    updated: messageUpdated,
  } = props.message;
  const fromAssistant = messageRole === 'assistant';
  const fromSystem = messageRole === 'system';
  const fromUser = messageRole === 'user';
  const wasEdited = !!messageUpdated;

  // state
  const [diffs, setDiffs] = React.useState<TextDiff[] | null>(null);
  const [forceExpanded, setForceExpanded] = React.useState(false);
  const [isHovering, setIsHovering] = React.useState(false);
  const [menuAnchor, setMenuAnchor] = React.useState<HTMLElement | null>(null);
  const [isEditing, setIsEditing] = React.useState(false);
  const [isImagining, setIsImagining] = React.useState(false);
  const [isSpeaking, setIsSpeaking] = React.useState(false);

  // external state
  const theme = useTheme();
  const { showAvatars, renderMarkdown: _renderMarkdown, doubleClickToEdit } = useUIPreferencesStore(state => ({
    showAvatars: state.zenMode !== 'cleaner',
    renderMarkdown: state.renderMarkdown,
    doubleClickToEdit: state.doubleClickToEdit,
  }), shallow);
  const renderMarkdown = _renderMarkdown && !fromSystem;
  const isImaginable = canUseProdia() && !!props.onImagine;
  const isImaginableEnabled = messageText?.length >= 2 && !messageText.startsWith('https://images.prodia.xyz/') && !(messageText.startsWith('/imagine') || messageText.startsWith('/img'));
  const isSpeakable = canUseElevenLabs();
  const isSpeakableEnabled = isImaginableEnabled;


  // Effect: text diffing vs the former message
  React.useEffect(() => {
    if (!props.diffText)
      return setDiffs(null);
    setDiffs(
      cleanupEfficiency(makeDiff(props.diffText, messageText, {
        timeout: 1,
        checkLines: true,
      }), 4),
    );
  }, [messageText, props.diffText]);


  const closeOperationsMenu = () => setMenuAnchor(null);

  const handleMenuCopy = (e: React.MouseEvent) => {
    copyToClipboard(messageText);
    e.preventDefault();
    closeOperationsMenu();
  };

  const handleMenuEdit = (e: React.MouseEvent) => {
    if (messageTyping && !isEditing) return; // don't allow editing while typing
    setIsEditing(!isEditing);
    e.preventDefault();
    closeOperationsMenu();
  };


  const handleMenuImagine = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (props.onImagine) {
      setIsImagining(true);
      await props.onImagine(messageText);
      setIsImagining(false);
      closeOperationsMenu();
    }
  };

  const handleMenuSpeak = async (e: React.MouseEvent) => {
    e.preventDefault();
    setIsSpeaking(true);
    await speakText(messageText);
    setIsSpeaking(false);
    closeOperationsMenu();
  };

  const handleMenuRunAgain = (e: React.MouseEvent) => {
    e.preventDefault();
    if (props.onMessageRunFrom) {
      props.onMessageRunFrom(fromAssistant ? -1 : 0);
      closeOperationsMenu();
    }
  };

  const handleTextEdited = (editedText: string) => {
    setIsEditing(false);
    if (editedText?.trim() && editedText !== messageText)
      props.onMessageEdit(editedText);
  };

  const handleExpand = () => setForceExpanded(true);


  // soft error handling
  const { isAssistantError, errorMessage } = React.useMemo(
    () => explainErrorInMessage(messageText, fromAssistant, messageOriginLLM),
    [messageText, fromAssistant, messageOriginLLM],
  );

  // style
  const backgroundColor = messageBackground(messageRole, wasEdited, isAssistantError && !errorMessage);

  // avatar
  const avatarEl: React.JSX.Element | null = React.useMemo(
    () => showAvatars ? makeAvatar(messageAvatar, messageRole, messageOriginLLM, messagePurposeId, messageSender, messageTyping) : null,
    [messageAvatar, messageOriginLLM, messagePurposeId, messageRole, messageSender, messageTyping, showAvatars],
  );

  // per-blocks css
  const blockSx: SxProps = {
    my: 'auto',
  };
  const codeSx: SxProps = {
    // backgroundColor: fromAssistant ? 'background.level1' : 'background.level1',
    backgroundColor: fromAssistant ? 'neutral.plainHoverBg' : 'primary.plainActiveBg',
    boxShadow: 'xs',
    fontFamily: theme.fontFamily.code,
    fontSize: '14px',
    fontVariantLigatures: 'none',
    lineHeight: 1.75,
    borderRadius: 'var(--joy-radius-sm)',
  };

  // user message truncation
  let collapsedText = messageText;
  let isCollapsed = false;
  if (fromUser && !forceExpanded) {
    const lines = messageText.split('\n');
    if (lines.length > 10) {
      collapsedText = lines.slice(0, 10).join('\n');
      isCollapsed = true;
    }
  }


  return (
    <ListItem
      // [alpha] Right-click menu: still in early development
      // onContextMenu={event => setMenuAnchor(event.currentTarget)}
      sx={{
        display: 'flex', flexDirection: !fromAssistant ? 'row-reverse' : 'row', alignItems: 'flex-start',
        gap: { xs: 0, md: 1 }, px: { xs: 1, md: 2 }, py: 2,
        backgroundColor,
        ...(props.noBottomBorder !== true && {
          borderBottom: '1px solid',
          borderBottomColor: 'divider',
        }),
        ...(ENABLE_COPY_MESSAGE && { position: 'relative' }),
        ...(props.isBottom === true && { mb: 'auto' }),
        '&:hover > button': { opacity: 1 },
      }}
    >

      {/* Avatar */}
      {showAvatars && <Stack
        sx={{ alignItems: 'center', minWidth: { xs: 50, md: 64 }, maxWidth: 80, textAlign: 'center' }}
        onMouseEnter={() => setIsHovering(true)} onMouseLeave={() => setIsHovering(false)}
        onClick={event => setMenuAnchor(event.currentTarget)}>

        {isHovering ? (
          <IconButton variant='soft' color={fromAssistant ? 'neutral' : 'primary'}>
            <MoreVertIcon />
          </IconButton>
        ) : (
          avatarEl
        )}

        {/* Assistant model name */}
        {fromAssistant && (
          <Tooltip title={messageOriginLLM || 'unk-model'} variant='solid'>
            <Typography level='body-sm' sx={{
              fontSize: { xs: 'xs', sm: 'sm' }, fontWeight: 500,
              overflowWrap: 'anywhere',
              ...(messageTyping ? { animation: `${cssRainbowColorKeyframes} 5s linear infinite` } : {}),
            }}>
              {prettyBaseModel(messageOriginLLM)}
            </Typography>
          </Tooltip>
        )}

      </Stack>}


      {/* Edit / Blocks */}
      {!isEditing ? (

        <Box
          onDoubleClick={(e) => doubleClickToEdit ? handleMenuEdit(e) : null}
          sx={{
            ...blockSx,
            flexGrow: 0,
            overflowX: 'auto',
          }}>

          {props.showDate === true && (
            <Typography level='body-sm' sx={{ mx: 1.5, textAlign: fromAssistant ? 'left' : 'right' }}>
              <TimeAgo date={messageUpdated || messageCreated} />
            </Typography>
          )}

          {/* Warn about user-edited system message */}
          {fromSystem && wasEdited && (
            <Typography level='body-sm' color='warning' sx={{ mt: 1, mx: 1.5 }}>modified by user - auto-update disabled</Typography>
          )}

          {!errorMessage && parseBlocks(collapsedText, fromSystem, diffs).map((block, index) =>
            block.type === 'html'
              ? <RenderHtml key={'html-' + index} htmlBlock={block} sx={codeSx} />
              : block.type === 'code'
                ? <RenderCode key={'code-' + index} codeBlock={block} sx={codeSx} />
                : block.type === 'image'
                  ? <RenderImage key={'image-' + index} imageBlock={block} allowRunAgain={props.isBottom === true} onRunAgain={handleMenuRunAgain} />
                  : block.type === 'latex'
                    ? <RenderLatex key={'latex-' + index} latexBlock={block} />
                    : block.type === 'diff'
                      ? <RenderTextDiff key={'latex-' + index} diffBlock={block} />
                      : renderMarkdown
                        ? <RenderMarkdown key={'text-md-' + index} textBlock={block} />
                        : <RenderText key={'text-' + index} textBlock={block} />,
          )}

          {errorMessage && (
            <Tooltip title={<Typography sx={{ maxWidth: 800 }}>{collapsedText}</Typography>} variant='soft'>
              <InlineError error={errorMessage} />
            </Tooltip>
          )}

          {isCollapsed && (
            <Button variant='plain' color='neutral' onClick={handleExpand}>... expand ...</Button>
          )}

          {/* import VisibilityIcon from '@mui/icons-material/Visibility'; */}
          {/*<br />*/}
          {/*<Chip variant='outlined' color='warning' sx={{ mt: 1, fontSize: '0.75em' }} startDecorator={<VisibilityIcon />}>*/}
          {/*  BlockAction*/}
          {/*</Chip>*/}

        </Box>

      ) : (

        <InlineTextarea initialText={messageText} onEdit={handleTextEdited} sx={{ ...blockSx, lineHeight: 1.75, flexGrow: 1 }} />

      )}


      {/* Copy message */}
      {ENABLE_COPY_MESSAGE && !fromSystem && !isEditing && (
        <Tooltip title={fromAssistant ? 'Copy message' : 'Copy input'} variant='solid'>
          <IconButton
            variant='outlined' color='neutral' onClick={handleMenuCopy}
            sx={{
              position: 'absolute', ...(fromAssistant ? { right: { xs: 12, md: 28 } } : { left: { xs: 12, md: 28 } }), zIndex: 10,
              opacity: 0, transition: 'opacity 0.3s',
            }}>
            <ContentCopyIcon />
          </IconButton>
        </Tooltip>
      )}


      {/* Message Operations menu */}
      {!!menuAnchor && (
        <CloseableMenu
          placement='bottom-end' sx={{ minWidth: 280 }}
          open anchorEl={menuAnchor} onClose={closeOperationsMenu}
        >
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <MenuItem variant='plain' disabled={messageTyping} onClick={handleMenuEdit} sx={{ flex: 1 }}>
              <ListItemDecorator><EditIcon /></ListItemDecorator>
              {isEditing ? 'Discard' : 'Edit'}
              {/*{!isEditing && <span style={{ opacity: 0.5, marginLeft: '8px' }}>{doubleClickToEdit ? '(double-click)' : ''}</span>}*/}
            </MenuItem>
            <MenuItem onClick={handleMenuCopy} sx={{ flex: 1 }}>
              <ListItemDecorator><ContentCopyIcon /></ListItemDecorator>
              Copy
            </MenuItem>
          </Box>
          <ListDivider />
          {!!props.onMessageRunFrom && (
            <MenuItem onClick={handleMenuRunAgain}>
              <ListItemDecorator>{fromAssistant ? <ReplayIcon /> : <FastForwardIcon />}</ListItemDecorator>
              {!fromAssistant
                ? 'Run from here'
                : !props.isBottom
                  ? 'Retry from here'
                  : <Box sx={{ flexGrow: 1, display: 'flex', justifyContent: 'space-between', gap: 1 }}>
                    Retry
                    <KeyStroke light combo='Ctrl + Shift + R' sx={hideOnMobile} />
                  </Box>
              }
            </MenuItem>
          )}
          {isImaginable && isImaginableEnabled && (
            <MenuItem onClick={handleMenuImagine} disabled={!isImaginableEnabled || isImagining}>
              <ListItemDecorator>{isImagining ? <CircularProgress size='sm' /> : <FormatPaintIcon color='success' />}</ListItemDecorator>
              Imagine
            </MenuItem>
          )}
          {isSpeakable && isSpeakableEnabled && (
            <MenuItem onClick={handleMenuSpeak} disabled={isSpeaking}>
              <ListItemDecorator>{isSpeaking ? <CircularProgress size='sm' /> : <RecordVoiceOverIcon color='success' />}</ListItemDecorator>
              Speak
            </MenuItem>
          )}
          {!!props.onMessageRunFrom && <ListDivider />}
          {!!props.onMessageDelete && (
            <MenuItem onClick={props.onMessageDelete} disabled={false /*fromSystem*/}>
              <ListItemDecorator><ClearIcon /></ListItemDecorator>
              Delete
            </MenuItem>
          )}
        </CloseableMenu>
      )}

    </ListItem>
  );
}
