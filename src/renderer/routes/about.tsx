import LinkTargetBlank from '@/components/Link'
import Markdown from '@/components/Markdown'
import Page from '@/components/Page'
import LogoWechat from '@/components/icons/LogoWechat'
import LogoX from '@/components/icons/LogoX'
import LogoXHS from '@/components/icons/LogoXHS'
import IMG_WECHAT_QRCODE from '@/static/wechat_qrcode.png'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import { Alert, Box, Button, Popover, useTheme } from '@mui/material'
import { createFileRoute } from '@tanstack/react-router'
import { useAtom, useAtomValue } from 'jotai'
import { MouseEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useVersion from '../hooks/useVersion'
import * as i18n from '../i18n'
import platform from '../platform'
import iconPNG from '../static/icon.png'
import * as atoms from '../stores/atoms'

export const Route = createFileRoute('/about')({
  component: About,
})

function About() {
  const { t, i18n: _i18n } = useTranslation()
  const theme = useTheme()
  const [open, setOpen] = useAtom(atoms.openAboutDialogAtom)
  const language = useAtomValue(atoms.languageAtom)
  const versionHook = useVersion()
  // const [sponsorBanners, setSponsorBanners] = useState<SponsorAboutBanner[]>([])
  // useEffect(() => {
  //     if (open) {
  //         remote.listSponsorAboutBanner().then(setSponsorBanners)
  //         trackingEvent('about_window', { event_category: 'screen_view' })
  //     } else {
  //         setSponsorBanners([])
  //     }
  // }, [open])
  const handleClose = () => {
    setOpen(false)
  }

  const [wechatPopoverAnchorEl, setWechatPopoverAnchorEl] = useState<HTMLElement | null>(null)

  const handleWechatPopoverOpen = (event: MouseEvent<HTMLElement>) => {
    setWechatPopoverAnchorEl(event.currentTarget)
  }

  const handleWechatPopoverClose = () => {
    setWechatPopoverAnchorEl(null)
  }

  const wechatPopoverOpen = Boolean(wechatPopoverAnchorEl)

  return (
    <Page title="About Chatbox">
      <div className="max-w-3xl mx-auto">
        <Box sx={{ textAlign: 'center', padding: '0 20px' }}>
          <img src={iconPNG} style={{ width: '100px', margin: 0, display: 'inline-block' }} />
          <h3 style={{ margin: '4px 0 5px 0' }}>
            Chatbox
            {/\d/.test(versionHook.version) ? `(v${versionHook.version})` : ''}
          </h3>
          <p className="p-0 m-0">{t('about-slogan')}</p>
          <p className="p-0 m-0 opacity-60 text-xs">{t('about-introduction')}</p>
          {/* <p className="p-0 m-0 text-center text-xs opacity-70">
            <LinkTargetBlank
              href="https://chatboxai.app/privacy"
              className="mx-2 no-underline hover:underline"
              style={{ color: theme.palette.text.primary }}
            >
              Privacy Policy
            </LinkTargetBlank>
            <LinkTargetBlank
              href="https://chatboxai.app/terms"
              className="mx-2 no-underline hover:underline"
              style={{ color: theme.palette.text.primary }}
            >
              User Terms
            </LinkTargetBlank>
          </p> */}
        </Box>
        {/* <Box
          sx={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
          className="mt-1 mb-4"
        >
          <Button
            variant="outlined"
            onClick={() => platform.openLink(`https://chatboxai.app/redirect_app/check_update/${language}`)}
          >
            {t('Check Update')}
          </Button>
          <Button
            variant="outlined"
            sx={{ margin: '4px' }}
            onClick={() => platform.openLink(`https://chatboxai.app/redirect_app/homepage/${language}`)}
          >
            {t('Homepage')}
          </Button>
          <Button
            variant="outlined"
            sx={{ margin: '4px' }}
            onClick={() => platform.openLink(`https://chatboxai.app/redirect_app/feedback/${language}`)}
          >
            {t('Feedback')}
          </Button>
          <Button
            variant="outlined"
            sx={{ margin: '4px' }}
            onClick={() =>
              platform.openLink(
                `https://chatboxai.app/${language.split('-')[0] || 'en'}/help-center/chatbox-ai-service-faqs`
              )
            }
          >
            {t('FAQs')}
          </Button>
          <Button
            variant="outlined"
            sx={{ margin: '4px' }}
            onClick={() => platform.openLink(`mailto://hi@chatboxai.com`)}
          >
            {t('Email Us')}
          </Button>
        </Box> */}
        {/* <Box className="flex flex-row gap-4 justify-center items-center mb-6">
          <a href="https://x.com/ChatboxAI_HQ" target="_blank">
            <LogoX className="w-6 h-6" />
          </a>
          <a className="cursor-pointer" onMouseEnter={handleWechatPopoverOpen} onMouseLeave={handleWechatPopoverClose}>
            <LogoWechat className="w-6 h-6" />
          </a>
          <Popover
            id="mouse-over-popover"
            sx={{ pointerEvents: 'none' }}
            open={wechatPopoverOpen}
            anchorEl={wechatPopoverAnchorEl}
            anchorOrigin={{
              vertical: 'bottom',
              horizontal: 'left',
            }}
            transformOrigin={{
              vertical: 'top',
              horizontal: 'left',
            }}
            onClose={handleWechatPopoverClose}
            disableRestoreFocus
          >
            <img src={IMG_WECHAT_QRCODE} alt="wechat qrcode" className="block w-32 h-32" />
          </Popover>
          <a href="https://www.xiaohongshu.com/user/profile/67b581b6000000000e01d11f" target="_blank">
            <LogoXHS className="w-6 h-6" />
          </a>
        </Box> */}
        <Box>
          <h4 className="text-center mb-1 mt-2">{t('Changelog')}</h4>
          <Box className="px-6">
            <Markdown>{i18n.changelog()}</Markdown>
          </Box>
        </Box>
      </div>
    </Page>
  )
}
