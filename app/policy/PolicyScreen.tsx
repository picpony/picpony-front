'use client';

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import Card from '@/components/Card';
import Tabs, { type TabItem } from '@/components/Tabs';
import TabPanes, { TabPane } from '@/components/TabPanes';
import PageHeader from '@/components/PageHeader';
import PageBack from '@/components/PageBack';
import { useEscapeBack } from '@/lib/hooks';
import { useBackOrParent } from '@/lib/backNavigation';
import { scrollAppToElement } from '@/lib/scrollTo';
import { cn } from '@/lib/utils';
import SectionHeading from '@/components/SectionHeading';
import { dropQueuedPolicyAddress, isPolicyTab, policyHref, replacePolicyAddress, type PolicyTab } from './address';

type PolicyKey = PolicyTab;

/**
 * The documents' revision, printed under each one's title. Copy, not a computed date — the
 * documents name their own month — so it is one constant rather than three literals.
 */
const REVISED = '2026年6月';

const TABS: TabItem<PolicyKey>[] = [
  { value: 'cookie', label: 'Cookie 政策' },
  { value: 'agreement', label: '服务协议' },
  { value: 'privacy', label: '隐私政策' },
  { value: 'faq', label: '常见问题' },
];

/**
 * A paragraph of a document. `tone="warning"` is the one caution the documents carry, as a role
 * rather than a second colour utility beside the paragraph's own (R7-038). The body is
 * `on-surface`: these are documents read at length, on a forum thread's article surface
 * (D1-022), and supporting ink is for the lines around them, like the revision date.
 */
function P({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'warning' }) {
  return <p className={cn('text-body-m', tone === 'warning' ? 'text-warning' : 'text-on-surface')}>{children}</p>;
}

/** A document's numbered section: the level under the page's own `<h1>` (axe `heading-order`). */
function H2({ children }: { children: ReactNode }) {
  return (
    <SectionHeading as="h2" className="mt-6 mb-2">
      {children}
    </SectionHeading>
  );
}

/** The revision line under each document. */
function Revised() {
  return <p className="text-body-s text-on-surface-variant">更新日期：{REVISED}</p>;
}

function UL({ children }: { children: ReactNode }) {
  return <ul className="mt-2 list-disc space-y-2 pl-6 text-body-m text-on-surface marker:text-on-surface-variant">{children}</ul>;
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-xs bg-surface-container-high px-1.5 py-0.5 font-mono text-body-s text-on-surface">
      {children}
    </code>
  );
}

function OutLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="prose-link focus-visible:ring-2 focus-ring"
    >
      {children}
    </a>
  );
}

/** Cookie 与本地存储政策 */
function CookiePolicy() {
  return (
    <div>
      <Revised />
      <div className="mt-3 space-y-3">
        <P>
          PicPony（中文小马图库）使用必要的会话 Cookie 与浏览器本地存储，以维持登录状态、保存浏览偏好并保障站点安全。
        </P>
        <H2>1. Cookie、Session 与本地存储</H2>
        <P>
          <strong>Cookie：</strong>由网站写入浏览器的文本数据，用于在不同页面间维持会话状态。
        </P>
        <P>
          <strong>Session（服务器会话）：</strong>保存在服务端的临时会话状态。登录时站点会设置仅限 HTTP 访问（HttpOnly）的会话绑定 Cookie（<Code>auth_bind</Code>），将登录凭证与当前浏览器绑定，并配合 CSRF 校验令牌防止跨站请求伪造。
        </P>
        <P>
          <strong>本地存储（Local Storage）：</strong>保存在浏览器本地的数据，不会随每次请求发送至服务器。
        </P>
        <H2>2. 使用用途</H2>
        <P>
          PicPony 主要依赖浏览器本地存储和必要的会话 Cookie，不用于跨站追踪浏览记录，也不会向第三方出售相关数据，仅用于维持登录状态、记住浏览设置及接口安全防护。
        </P>
        <H2>3. 存储的数据内容</H2>
        <UL>
          <li>
            <strong>账号与身份认证（本地存储）：</strong>包括登录令牌（Token）、脱敏显示的 Derpibooru API Key（如 <Code>abc********rst</Code>）、用户名及头像链接，以便再次打开网站时保持登录状态。
          </li>
          <li>
            <strong>会话与安全防护（Session / Cookie）：</strong>保存服务端临时会话凭证、CSRF 校验令牌及请求频率限制计数。
          </li>
          <li>
            <strong>内容筛选与偏好（本地存储）：</strong>包括「内容分级」设置（如 Safe 或 Spoilers）、「隐藏类人生物」、「屏蔽敏感或不适内容」、「只看小马（含类马）」开关，以及自定义屏蔽组与标签组。
          </li>
          <li>
            <strong>界面与线路偏好（本地存储）：</strong>包括「显示标签数量」、「显示中文标签」、「启用图片 CDN 加速」、「启用 PicPony 加速服务器」、「启用 PicPony API」、「启用 API 加速」等设置项。
          </li>
          <li>
            <strong>历史与缓存（本地存储）：</strong>在本地保存「搜索历史」、浏览记录与少量页面缓存，用于减少重复加载。
          </li>
        </UL>
        <H2>4. 验证与第三方服务</H2>
        <UL>
          <li>
            <strong>本地滑块验证：</strong>在登录、注册或找回密码时完成拼图验证，系统仅在浏览器端短暂采集本次拖动轨迹用于服务端即时校验。<strong>轨迹数据完成核验后即刻丢弃，不在服务端持久化保存。</strong>
          </li>
          <li>
            <strong>图片与资源加速服务：</strong>在设置中开启「启用图片 CDN 加速」或「启用 PicPony 加速服务器」后，站点通过加速节点与代理服务（如 <Code>wsrv.nl</Code>）拉取资源，不会写入追踪 Cookie。
          </li>
          <li>
            <strong>第三方翻译引擎：</strong>评论翻译通过第三方翻译接口（如 Lingva API 或 MyMemory API）完成，不使用追踪 Cookie。
          </li>
        </UL>
        <H2>5. 管理与清除</H2>
        <UL>
          <li>
            <strong>站内清除：</strong>可在搜索页清空搜索历史，在「设置」中解除 API Key 绑定，或在侧边栏点击「登出」销毁当前设备上的登录 Token、本地配置及服务端 Session。
          </li>
          <li>
            <strong>浏览器清除：</strong>可通过浏览器的「隐私与安全」设置随时清除 PicPony 的 Cookie 与站点数据。
          </li>
        </UL>
        <P tone="warning">
          <strong>注意：</strong>在浏览器中禁用 Cookie 或本地存储，将导致登录、偏好保存、安全验证与云端收藏等功能无法正常使用。
        </P>
        <H2>6. 联系方式</H2>
        <P>如对本《Cookie 与本地存储政策》有疑问，可通过官方交流群（QQ 群：1074070030）联系管理团队。</P>
      </div>
    </div>
  );
}

/**
 * A reference from one document to another, as a link to that tab: followed in place (the tab
 * switches, the reader is brought to its top) and, opened in a new tab, the address itself.
 */
function DocumentLink({ tab, onOpen, children }: { tab: PolicyKey; onOpen: (tab: PolicyKey) => void; children: ReactNode }) {
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onOpen(tab);
  };
  return (
    <a href={policyHref(tab)} onClick={follow} className="prose-link focus-visible:ring-2 focus-ring">
      {children}
    </a>
  );
}

/** PicPony 用户服务协议 */
function AgreementPolicy({ onOpen }: { onOpen: (tab: PolicyKey) => void }) {
  return (
    <div>
      <Revised />
      <div className="mt-3 space-y-3">
        <P>
          使用 PicPony（以下称「本站」）前，请阅读本《PicPony 用户服务协议》（以下称「本协议」）。注册、登录或使用本站即视为同意接受本协议约束。
        </P>
        <H2>1. 服务说明与平台性质</H2>
        <P>1.1 本站是面向《我的小马驹》（My Little Pony）同人社区的中文镜像站点。</P>
        <P>1.2 本站的图片、标签库与基础评论数据均通过公共 API 来源于海外平台（Derpibooru / Trixiebooru）。本站仅提供本地化展示、中英标签词库、搜索增强与云端收藏服务，不直接托管原站高清图片文件。</P>
        <P>1.3 本站为非营利性质的同人交流平台。</P>
        <H2>2. 账号注册、API 凭证与安全</H2>
        <P>2.1 注册本站账号须绑定有效电子邮箱，该邮箱用于密码找回及安全通知。用户应妥善保管账号与密码，并对该账号下的全部操作承担责任。</P>
        <P>2.2 绑定 Derpibooru API Key 后，本站将在服务端加密存储该凭证，并在界面中脱敏显示（如 <Code>abc********rst</Code>）。用户应妥善保管个人凭证；因自身保管不善导致泄露的，相关责任由用户自行承担。</P>
        <P>2.3 若发现账号或 API Key 异常，请立即在「设置」中解除绑定并修改密码。</P>
        <H2>3. 用户行为规范</H2>
        <P>3.1 使用本站须遵守《中华人民共和国网络安全法》等中国法律法规，不得利用本站从事违法违规行为。</P>
        <P>3.2 <strong>内容发布规范：</strong>在评论、发帖、反馈及个人资料等互动功能中，严禁发布、传播包含以下内容的信息：</P>
        <ol className="space-y-2 pl-4 text-body-m text-on-surface">
          <li>（1）反对宪法所确定的基本原则的；</li>
          <li>（2）危害国家安全，泄露国家秘密，颠覆国家政权，破坏国家统一的；</li>
          <li>（3）损害国家荣誉和利益的；</li>
          <li>（4）煽动民族仇恨、民族歧视，破坏民族团结的；</li>
          <li>（5）破坏国家宗教政策，宣扬邪教和封建迷信的；</li>
          <li>（6）散布谣言，扰乱社会秩序，破坏社会稳定的；</li>
          <li>（7）散布淫秽、色情、赌博、暴力、凶杀、恐怖或者教唆犯罪的（包括但不限于违反相关管理规定的成人、血腥等限制级内容）；</li>
          <li>（8）侮辱或者诽谤他人，侵害他人合法权益的；</li>
          <li>（9）含有法律、行政法规禁止的其他内容的。</li>
        </ol>
        <P>本站对评论区、论坛及反馈内容配置了自动 HTML 净化过滤（XSS 防护）。严禁尝试注入恶意 JavaScript、HTML 片段或发起 CSRF 攻击。</P>
        <P>3.3 <strong>作品上传规范：</strong>上传作品须为本人原创或已获得原作者明确授权，严禁盗图、恶意篡改他人作品或发布与 MLP 社区无关的内容。</P>
        <H2>4. 内容过滤与安全限制</H2>
        <P>4.1 为遵守相关法律法规并保护未成年人，本站默认开启「内容分级」中的「完全安全（Safe）」过滤限制级内容。</P>
        <P>4.2 不得通过技术手段绕过本站的内容过滤或安全限制。</P>
        <P>4.3 <strong>防刷与速率限制：</strong>为保障服务可用性，本站接口配置了请求频率限制与拼图验证，禁止使用自动化脚本、连点器或多线程爬虫高频请求或批量抓取。检测到异常请求或异常验证轨迹时，系统将限制访问或封禁对应账号与 IP。</P>
        <P>4.4 本站保留对站内评论、帖子、反馈及上传内容的审核权。发现违规时，本站可不经事先通知直接删除违规内容、封禁账号或限制访问。</P>
        <H2>5. 知识产权</H2>
        <P>5.1 本站页面设计、前端代码等知识产权归开发团队所有，中英翻译词库数据归词库小编团队所有；部分译名参考了 MLP 中文维基与其他网络来源，并遵循{' '}
          <OutLink href="https://creativecommons.org/licenses/by-sa/3.0/deed.en">知识共享 署名-相同方式共享 3.0</OutLink>。
        </P>
        <P>5.2 本站展示的画作、图片及相关衍生内容的著作权归原作者及原发布平台所有，本站不主张任何所有权。</P>
        <P>5.3 如需转载或商用本站展示的作品，请前往原站（Derpibooru）查阅原作者的许可声明，本站无权代为授权。</P>
        <P>
          5.4 桌面小马功能的动画引擎为 Browser Ponies（Mathias Panzenböck，MIT 许可证，许可声明随代码保留）；角色素材来源于 Desktop Ponies 社区项目（GitHub 仓库：
          <OutLink href="https://github.com/RoosterDragon/Desktop-Ponies">RoosterDragon/Desktop-Ponies</OutLink>
          ），各素材著作权归原作者所有，本站不主张所有权或代为授权。My Little Pony 角色相关权利归其权利人所有。
        </P>
        <H2>6. 免责声明</H2>
        <P>6.1 <strong>数据来源免责：</strong>本站展示的原站内容由 Derpibooru API 提供，无法对全部外部数据进行实时事前审查。如发现违规或侵权内容，请通过「举报」功能反馈，管理团队将在核实后于本站内屏蔽处理；原站数据源内容本身的责任由原平台与发布者承担。</P>
        <P>6.2 <strong>服务可用性免责：</strong>因网络波动、不可抗力、跨境链路状况或原站 API 限流、熔断与规则调整导致的服务中断、加载失败或功能异常，本站不承担违约或赔偿责任。</P>
        <P>6.3 <strong>数据丢失免责：</strong>本站会采取合理措施保护云端收藏、历史记录及会话安全，但仍建议自行备份重要内容；因不可抗力或服务器故障导致的数据丢失，本站免责。</P>
        <H2>7. 协议的变更与终止</H2>
        <P>7.1 本站可根据法律法规变化或运营需要修改本协议，修改后的协议将在站内公布并自公布时生效。</P>
        <P>7.2 若不同意修改后的协议，应停止使用本站服务；继续使用即视为接受修改后的协议。</P>
        <P>7.3 如严重违反本协议，本站可随时终止提供服务并封禁账号。</P>
        <H2>8. 其他</H2>
        <P>8.1 本协议的成立、生效、履行、解释及纠纷解决，适用中华人民共和国大陆地区法律。</P>
        <P>
          8.2 关于个人信息的收集与使用规则，请参阅
          <DocumentLink tab="privacy" onOpen={onOpen}>《PicPony 隐私政策》</DocumentLink>。
        </P>
        <P>8.3 如对本协议有疑问，可通过官方交流群（QQ 群：1074070030）联系管理团队。</P>
      </div>
    </div>
  );
}

/** PicPony 隐私政策 */
function PrivacyPolicy() {
  return (
    <div>
      <Revised />
      <div className="mt-3 space-y-3">
        <P>
          本《隐私政策》说明 PicPony 在提供服务过程中如何收集、使用、存储与保护用户相关信息。请在使用本站服务前仔细阅读。
        </P>
        <H2>1. 收集的信息及用途</H2>
        <UL>
          <li><strong>账号注册与登录信息：</strong>注册时收集用户名、密码及绑定的邮箱地址，用于身份验证、找回密码验证码发送及安全系统通知。</li>
          <li><strong>Derpibooru API Key：</strong>绑定 Derpibooru API Key 后，本站将在服务端加密存储并在界面中脱敏显示（如 <Code>abc********rst</Code>），仅用于代表用户与原站同步设置及核验身份，不作其他用途。</li>
          <li><strong>安全验证滑动轨迹：</strong>在登录、注册或重置密码时拖动滑块拼图，系统会在浏览器端短暂收集本次拖动轨迹并加密提交至后端用于防自动化脚本校验。<strong>校验完成后轨迹数据即刻在内存中销毁，不写入持久化数据库。</strong></li>
          <li><strong>用户互动数据：</strong>使用收藏、评论、论坛、标签反馈或上传功能时，图片 ID、文本内容、标签及媒体文件将被提交至本站后台或 Derpibooru 原站；所有评论与反馈在存储前均经过自动 HTML 净化处理。</li>
          <li><strong>彩彩 AI 对话：</strong>当使用彩彩 AI 助手时，输入的对话内容、当前页面的基本信息（页面地址与可用入口），以及助手为完成请求而读取的站内信息（如收藏夹、任务进度、最近联系人与私信摘要），会发送至本站后台，并转交已配置的大语言模型服务（可能为第三方服务商）生成回复。涉及写入的操作须经确认或设置授权方可执行。请勿在对话中输入密码、API Key 等敏感信息。</li>
          <li><strong>以图搜图上传文件：</strong>使用「以图搜图」上传本地图片时，图片仅用于即时相似度比对，服务器不保留所上传的图片。</li>
          <li><strong>本地偏好与缓存数据：</strong>内容分级、线路加速开关、屏蔽组、标签组、搜索历史及 API Key 历史等偏好以 localStorage 保存在浏览器中，不上传至服务器。登录后设置的会话绑定 Cookie <Code>auth_bind</Code> 仅用于校验请求来源，登出时清除。</li>
        </UL>
        <H2>2. 第三方服务与数据交互</H2>
        <P>运行过程中涉及与以下外部或第三方服务的数据交互：</P>
        <UL>
          <li><strong>Derpibooru / Trixiebooru：</strong>核心图片、标签库与基础评论数据来源于 trixiebooru.org；搜索、API Key 核验及图片上传均直接与原站服务器交互。</li>
          <li><strong>图片与资源加速服务：</strong>开启「启用图片 CDN 加速」或「启用 PicPony 加速服务器」时，通过加速节点与代理服务（如 <Code>wsrv.nl</Code>）拉取图片资源。</li>
          <li><strong>大语言模型服务：</strong>彩彩 AI 的回复由后台配置的大语言模型服务生成，对话内容及前文所述的站内上下文会经本站后台发送至该服务。</li>
          <li><strong>第三方翻译引擎：</strong>点击评论区的「翻译」按钮时，评论原文会发送至第三方翻译接口（如 Lingva API 或 MyMemory API）以获取中文翻译。</li>
        </UL>
        <H2>3. 数据存储与安全</H2>
        <P>本站采用对称加密、账号哈希与 XSS 自动净化机制等合理技术手段，保护账号密码与 API 凭证等敏感数据。</P>
        <P>登录凭证、部分偏好设置及搜索历史保存在浏览器的本地存储（localStorage）中，可随时通过浏览器清除站点数据，或在站内点击「登出」、「解除绑定」与清空搜索历史予以删除。</P>
        <H2>4. 用户权利</H2>
        <UL>
          <li><strong>访问与修改：</strong>可随时在「设置」的账号面板中修改用户名、密码及更新头像。</li>
          <li><strong>解除绑定：</strong>可随时在 API Key 设置中点击「解除绑定」，移除已保存的凭证并停止同步。</li>
          <li><strong>数据删除：</strong>可随时删除自己在本站发布的评论。</li>
        </UL>
        <H2>5. 内容分级与未成年人保护</H2>
        <P>本站内置「内容分级」过滤并默认处于「完全安全（Safe）」状态，用于过滤暴力、色情等限制级内容。</P>
        <P>如发现违规内容，可通过图片或评论旁的「举报」功能向管理团队反馈。</P>
        <H2>6. 政策更新与联系方式</H2>
        <P>本隐私政策可能随站点功能调整而修订；如有重要变更，将通过站内公告或消息通知。</P>
        <P>如有疑问或词库贡献意向，可加入官方交流群（QQ 群：1074070030）联系管理团队。</P>
      </div>
    </div>
  );
}

/** 常见问题（FAQ） */
function Faq() {
  const items: { q: string; a: ReactNode }[] = [
    {
      q: '什么是 PicPony？',
      a: 'PicPony 是面向《我的小马驹》（My Little Pony）及其同人作品的中文图库站点，经 Derpibooru（Trixiebooru）授权，通过公共 API 同步图库数据，并提供中文标签词库、筛选工具与以图搜图等本地化功能。',
    },
    {
      q: '忘记密码怎么找回？',
      a: '若账号已绑定有效电子邮箱，可在登录窗口点击「忘记密码」，输入用户名或注册邮箱接收 6 位数字验证码，验证后即可设置新密码。',
    },
    {
      q: '绑定 API Key 是否安全？',
      a: (
        <>
          本站对用户绑定的 API Key 在服务端采用对称加密存储，界面与后台均以脱敏形式展示（例如 <Code>abc********rst</Code>），无法查看完整明文。API Key 仅用于代表用户向原站（Derpibooru）发起授权请求，不作其他用途。
        </>
      ),
    },
    {
      q: '为什么滑块验证提示「检测到异常拖动，请重试」？',
      a: (
        <>
          为防止自动化脚本与爬虫请求，系统会校验滑动轨迹的连续性与自然度。轨迹呈绝对水平直线、完全匀速，或耗时过短与过长均可能触发拦截，请自然拖动滑块完成验证。
        </>
      ),
    },
    {
      q: '为什么我的作品会出现在这里？',
      a: 'PicPony 是 Derpibooru（Trixiebooru）的中文镜像站点，两站共享同一套公共图库。图片出现通常是因为原站社区用户将其收录至 Derpibooru 并添加了标签与原始来源链接。',
    },
    {
      q: '如何获取 API Key？',
      a: (
        <>
          注册并登录 Derpibooru（<OutLink href="https://trixiebooru.org/sessions/new">trixiebooru.org/sessions/new</OutLink>），进入 Account Settings 页面，在 API Key 区域点击「Click to show」即可查看并复制。
        </>
      ),
    },
    {
      q: '为什么部分图片搜不到或被过滤？',
      a: '本站默认开启「完全安全（Safe）」分级过滤，自动隐藏血腥、色情等限制级内容；如果在「设置」中开启了「隐藏类人生物」或「只看小马（含类马）」开关，也会隐藏不符合条件的图片。',
    },
    {
      q: '搜索框支持中文还是英文标签？',
      a: '搜索框既支持输入中文描述进行语义搜索，也支持使用英文标签与高级语法精确检索。原站底层数据以英文标签分类，本站内置了中英标签词库并持续扩充译名，点击标签上的「词库百科」即可查看解释。如需参与词库补充，可加入官方交流群（QQ 群：1074070030）。',
    },
    {
      q: '通过本站上传的作品会提交到哪里？',
      a: '在绑定 API Key 后使用「发布图片」功能，图片与填写的标签、描述将通过 API 直接上传至 Derpibooru（Trixiebooru）。请遵守原站上传规范与版权要求，勿上传未经授权或与 MLP 无关的作品。',
    },
    {
      q: '图片加载很慢怎么办？',
      a: '由于原站服务器位于海外，可在「设置」中开启「启用图片 CDN 加速」或「启用 PicPony 加速服务器」，通过加速节点拉取资源。',
    },
    {
      q: '如何举报违规内容？',
      a: '本站无法直接删除原站数据。如发现违规图片或评论，请点击详情页中的「举报」按钮，管理团队核实后将在本站内屏蔽处理；如需原站处置，请前往 Derpibooru（Trixiebooru）提交举报。',
    },
    {
      q: '如何删除已上传的图片？',
      a: '根据 Derpibooru（Trixiebooru）的规则，普通上传者通常无法直接删图，仅经认证的原作者可申请下架。如图片带有对应画师标签（artist:），可使用已认证该标签的 Derpibooru 账号前往原站申请下架。',
    },
    {
      q: '如何认证画师标签？',
      a: '登录 Derpibooru（trixiebooru.org）账号后，按原站画师认证流程提交本人作品主页与身份验证即可。',
    },
    {
      q: '我是原作者，作品未经允许被上传了怎么办？',
      a: (
        <>
          若你的 Derpibooru 账号已认证该图的 <Code>artist:</Code> 标签，可前往 Derpibooru 原图页面点击「Report」，选择一般举报中的「Takedown request」，并填写「I am the artist of this image, and I want to take it down.」。
        </>
      ),
    },
    {
      q: '我是原画师，但图片的艺术家标签有误怎么修改？',
      a: '请前往 Derpibooru 原图页面，点击标签栏旁的「Edit」按钮修改标签。',
    },
    {
      q: '我不想让自己的 OC 作品被上传到本站怎么办？',
      a: '依据通常的版权归属原则，委托创作（约稿）作品的著作权一般归创作画师所有（另有买断约定除外）。如上传者为画师本人可与其协商下架；如上传者为第三方，建议联系原画师在 Derpibooru 完成认证后申请下架。',
    },
    {
      q: '申请下架后仍有用户重复上传我的作品怎么办？',
      a: (
        <>
          完成 Derpibooru 画师认证后，可访问 <OutLink href="https://trixiebooru.org/dnp/new">trixiebooru.org/dnp/new</OutLink>，将画师标签设置为仅允许本人发布。
        </>
      ),
    },
  ];

  return (
    <dl className="space-y-5">
      {items.map((item, i) => (
        <div key={i}>
          <dt className="text-title-m text-on-surface">
            Q：{item.q}
          </dt>
          <dd className="mt-1 text-body-m text-on-surface">A：{item.a}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * 声明与政策. The tab is in the address (`./address.ts`): the server reads it, so a link to
 * 服务协议 arrives on 服务协议, and a switch writes it back in place.
 */
export default function PolicyScreen({ initialTab }: { initialTab: PolicyKey }) {
  const [active, setActive] = useState<PolicyKey>(initialTab);
  const rowRef = useRef<HTMLDivElement>(null);
  /* A footer destination, not a sidebar one, so it gets the back affordance. */
  const handleBack = useBackOrParent('/');
  useEscapeBack(handleBack);

  /* A link followed while the screen is up selects its tab. During render, the documented
     pattern for state that follows a prop. */
  const [seen, setSeen] = useState(initialTab);
  if (seen !== initialTab) {
    setSeen(initialTab);
    setActive(initialTab);
  }
  useEffect(() => dropQueuedPolicyAddress, []);

  /* An address naming no document — a mistyped or stale link — opened on the one on screen and
     kept saying otherwise; it is corrected in place, as /settings corrects its own (decision 23,
     G4-023). */
  const tabParam = useSearchParams().get('tab');
  useEffect(() => {
    if (tabParam !== null && !isPolicyTab(tabParam)) replacePolicyAddress(active);
  }, [tabParam, active]);

  const select = (next: PolicyKey) => {
    setActive(next);
    replacePolicyAddress(next);
  };

  /* A cross-reference: the tab switches, the reader is taken to the top of the document, and
     focus goes with them — the link they pressed has just left with its pane. */
  const open = (next: PolicyKey) => {
    select(next);
    // Include the page header's reserved back-button room when landing on the document.
    scrollAppToElement(rowRef.current?.parentElement ?? null);
    requestAnimationFrame(() => {
      rowRef.current?.parentElement
        ?.querySelector<HTMLElement>(`[data-tab-pane="${next}"]`)
        ?.focus({ preventScroll: true });
    });
  };

  return (
    <>
      <PageBack onClick={handleBack} />
      <div className="mx-auto max-w-4xl page-back-room">
      <PageHeader title="声明与政策" />

      {/* 板块切换，样式与消息/通知页一致 */}
      <div ref={rowRef}>
        <Tabs
          tabs={TABS}
          value={active}
          onChange={select}
          label="声明与政策"
          className="mb-6"
        />
      </div>

      {/* The card is *inside* each pane, not around all of them: the shared axis
          translates the panes a full window sideways, and a pane nested inside a card
          would slide out of a surface that stayed put. Every other screen slides content
          blocks *including* their surfaces. `lean`: the layered departure — the card, a
          surface, leans as one block. It is the article surface a forum thread's post sits
          on (`elevated`, D1-022): a long text on the heaviest tone step read as a block of
          colour with words in it. */}
      <TabPanes value={active} lean>
        <TabPane value="cookie">
          <Card variant="elevated" padding="lg">
            <CookiePolicy />
          </Card>
        </TabPane>
        <TabPane value="agreement">
          <Card variant="elevated" padding="lg">
            <AgreementPolicy onOpen={open} />
          </Card>
        </TabPane>
        <TabPane value="privacy">
          <Card variant="elevated" padding="lg">
            <PrivacyPolicy />
          </Card>
        </TabPane>
        <TabPane value="faq">
          <Card variant="elevated" padding="lg">
            <Faq />
          </Card>
        </TabPane>
      </TabPanes>
      </div>
    </>
  );
}
