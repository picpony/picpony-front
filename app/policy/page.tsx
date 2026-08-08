'use client';

import { useState, type ReactNode } from 'react';
import Card from '@/components/Card';
import TabBar, { type TabItem } from '@/components/TabBar';

type PolicyKey = 'cookie' | 'agreement' | 'privacy' | 'faq';

const TABS: TabItem<PolicyKey>[] = [
  { value: 'cookie', label: 'Cookie 政策' },
  { value: 'agreement', label: '服务协议' },
  { value: 'privacy', label: '隐私政策' },
  { value: 'faq', label: '常见问题' },
];

// 段落与列表项的通用排版
function P({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <p className={`text-body-m leading-relaxed text-on-surface-variant ${className}`}>{children}</p>
  );
}

function H3({ children }: { children: ReactNode }) {
  return <h3 className="mt-6 mb-2 text-title-m text-on-surface">{children}</h3>;
}

function UL({ children }: { children: ReactNode }) {
  return <ul className="mt-2 space-y-2 text-body-m leading-relaxed text-on-surface-variant">{children}</ul>;
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-sm bg-surface-container-high px-1.5 py-0.5 font-mono text-body-s text-on-surface">
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
      className="text-primary hover:underline"
    >
      {children}
    </a>
  );
}

/** Cookie 与本地存储政策 */
function CookiePolicy() {
  return (
    <div>
      <p className="text-body-s text-outline">更新日期：2026年6月</p>
      <div className="mt-3 space-y-3">
        <P>
          欢迎使用 PicPony（中文小马图站）。为了确保网站的正常运转、为您提供个性化的找图体验以及保障账号与系统安全，我们会在您的计算机或移动设备上存储少量的本地数据。本政策旨在向您清晰地说明我们如何使用 Cookie、Session 以及同类本地存储技术（Local Storage）。
        </P>
        <H3>1. 什么是 Cookie、Session 与本地存储技术？</H3>
        <P>
          <strong>Cookie：</strong> 一种由网站发送并存储在您浏览器上的小型纯文本文件，通常用于在您访问不同页面时维持会话状态。
        </P>
        <P>
          <strong>Session（服务器会话）：</strong> 在服务器端存储的用户临时会话状态。本站使用安全的 Session ID Cookie（通常名为 <Code>PHPSESSID</Code>）将您的浏览器与服务器会话关联，用于防护 CSRF 跨站请求伪造、维护登录安全以及执行轻量级的页面速率限制。
        </P>
        <P>
          <strong>本地存储（Local Storage）：</strong> 允许网站在您的浏览器中安全地存储较大数据量信息，且数据不会随每次网络请求发送给服务器，从而提升加载速度并保护隐私。
        </P>
        <H3>2. 我们如何使用这些技术？</H3>
        <P>
          作为一款重前端的镜像客户端，PicPony 主要依赖浏览器的“本地存储（Local Storage）”和必要的基础会话 Cookie。我们不使用这些技术来追踪您在其他第三方网站的浏览轨迹，也绝不会将您的存储数据提供或出售给任何广告商。存储数据的唯一目的，是让网站记住您的个性化配置、保障防刷防护安全，并使网站正常运行。
        </P>
        <H3>3. 我们具体存储了哪些类型的数据？</H3>
        <UL>
          <li>
            <strong>账号与身份认证（本地存储）：</strong> 包括您的登录令牌（Token）、绑定的 Derpibooru API Key（前端显示为脱敏状态，如 <Code>abc********rst</Code>）、用户名及头像链接。这些数据让您再次打开网页时无需重复登录或重新配置身份信息。
          </li>
          <li>
            <strong>会话与安全防护（Session / Cookie）：</strong> 临时的 Session 凭证，用于在服务端存储 CSRF 安全令牌、防刷暴力破解的速率限制计数器等。
          </li>
          <li>
            <strong>安全与内容过滤偏好（本地存储）：</strong> 网站会记住您的“内容分级过滤器”状态（如 Safe 或 Spoilers）、“禁止类人生物”开关、“只看小马”开关，以及您自定义的黑名单/打码标签组。
          </li>
          <li>
            <strong>界面与交互偏好（本地存储）：</strong> 网站会记录您是否开启了“视频自动预览”、“显示标签数量”、“图片 CDN 加速”、“启用 picpony 加速服务器”等开关。
          </li>
          <li>
            <strong>历史记录与性能缓存（本地存储）：</strong> 系统会在本地记录您的近期“搜索历史”和“API Key 使用历史”，并短暂缓存部分页面数据，以减少网络卡顿并降低服务器压力。
          </li>
        </UL>
        <H3>4. 人机验证与第三方技术说明</H3>
        <UL>
          <li>
            <strong>本地滑块人机验证：</strong> 我们放弃了传统的第三方人机验证，改用自研的本地滑块人机验证。滑块拼图验证时，系统会在您的浏览器端短暂收集滑动轨迹数据（包括 x/y 轴相对位移和时间戳组合），并在 XOR 加密后发送给后端，用于防爬虫生物特征分析。<strong>这些轨迹数据仅用于即时安全核验，后端不会进行任何持久化存储。</strong>
          </li>
          <li>
            <strong>图片与资源加速服务：</strong> 当您在设置中开启“启用图片 CDN 加速”或“启用 picpony 加速服务器”时，本站会通过加速节点与第三方代理服务（如 <Code>wsrv.nl</Code>）为您拉取并加速资源，不会向您的设备写入追踪 Cookie。
          </li>
          <li>
            <strong>第三方翻译引擎：</strong> 评论区的翻译服务通过第三方翻译接口（如 Lingva API 或 MyMemory API）进行，不使用 Cookie 追踪。
          </li>
        </UL>
        <H3>5. 您的管理与控制权限</H3>
        <UL>
          <li>
            <strong>站内清除：</strong> 您可以在本站下拉菜单中点击“清空搜索历史”、“清除绑定”定向删除特定数据；点击“退出登录”将销毁您设备上的登录 Token、本地收藏配置及身份认证信息，并清理服务端的 Session 会话。
          </li>
          <li>
            <strong>浏览器清除：</strong> 您可以通过主流浏览器（如 Chrome、Edge、Safari）的“设置 - 隐私和安全”功能，随时一键清除 PicPony 的所有 Cookie 及本地存储（Site Data）缓存。
          </li>
        </UL>
        <P className="!text-warning">
          <strong>请注意：</strong> 如果您强行在浏览器中禁用 Cookie 或本地存储功能，本站的核心功能（包括账号登录、偏好保存、防刷验证和云端收藏）将无法正常工作。
        </P>
        <H3>6. 联系我们</H3>
        <P>如果您对本《Cookie 与本地存储政策》有任何疑问或需要进一步的帮助，请通过我们的官方交流群（QQ群：1074070030）与管理团队联系。</P>
      </div>
    </div>
  );
}

/** PicPony 用户服务协议 */
function AgreementPolicy() {
  return (
    <div>
      <p className="text-body-s text-outline">更新日期：2026年6月</p>
      <div className="mt-3 space-y-3">
        <P>
          欢迎您使用 PicPony（中文小马图站，以下简称“本站”）！在您注册、登录及使用本站提供的各项服务之前，请您务必审慎阅读、充分理解本《PicPony 用户服务协议》（以下简称“本协议”）的各条款内容。您注册、登录或使用本站的行为，即视为您已阅读并同意接受本协议的全部约束。
        </P>
        <H3>1. 服务说明与平台性质</H3>
        <P>1.1 本站（PicPony）是一个专注于《我的小马驹》（My Little Pony）同人文化交流的中文镜像客户端。</P>
        <P>1.2 本站的核心图片、标签库、基础评论等数据均通过公共 API 接口来源于海外平台（Derpibooru / Trixiebooru）。本站仅提供数据的本地化展示、检索优化（如中英标签词库）及跨端云同步服务，本站自身不直接托管、存储原版高清图片文件。</P>
        <P>1.3 本站为非盈利性质的同人交流平台，致力于为国内 MLP 爱好者提供更便捷的浏览体验。</P>
        <H3>2. 账号注册、API 凭证与安全</H3>
        <P>2.1 您可以在本站注册专属账号，用于实现云端收藏、本站评论等功能。注册时您必须绑定真实有效的电子邮箱，该邮箱是您找回密码及重置密保凭证的唯一通道。您应当妥善保管您的账号和密码，并对使用该账号进行的所有活动承担全部法律责任。</P>
        <P>2.2 本站提供“绑定 Derpibooru API Key”功能。API Key 是您在平台的个人授权凭证，本站已在服务端实施强加密算法（对称加密）对 API Key 进行存储保护，并在后台管理中做脱敏展示（如 <Code>abc********rst</Code>）。尽管我们做出了高度安全保障，您仍有责任保护好自己的凭证。如因您自身原因导致凭证泄露，相关责任由您自行承担。</P>
        <P>2.3 若您发现账号或 API Key 被盗用，请立即在设置中清除绑定并修改密码。</P>
        <H3>3. 用户行为规范（重要）</H3>
        <P>3.1 您在使用本站服务时，必须严格遵守《中华人民共和国网络安全法》等相关中国法律法规，不得利用本站从事任何违法违规行为。</P>
        <P>3.2 <strong>内容发布红线与数据安全：</strong> 您在使用本站的评论、上传、标签反馈、个人主页编辑等互动功能时，严禁发布、传播包含以下内容的信息：</P>
        <UL>
          <li>（1）反对宪法所确定的基本原则的；</li>
          <li>（2）危害国家安全，泄露国家秘密，颠覆国家政权，破坏国家统一的；</li>
          <li>（3）损害国家荣誉和利益的；</li>
          <li>（4）煽动民族仇恨、民族歧视，破坏民族团结的；</li>
          <li>（5）破坏国家宗教政策，宣扬邪教和封建迷信的；</li>
          <li>（6）散布谣言，扰乱社会秩序，破坏社会稳定的；</li>
          <li>（7）散布淫秽、色情、赌博、暴力、凶杀、恐怖或者教唆犯罪的（包括但不限于严重触碰国内审查底线的 R18/NSFW、血腥重口内容）；</li>
          <li>（8）侮辱或者诽谤他人，侵害他人合法权益的；</li>
          <li>（9）含有法律、行政法规禁止的其他内容的。</li>
        </UL>
        <P>本站对评论区、论坛及反馈入口配置了自动 HTML 净化器（XSS 过滤器）。用户严禁通过修改数据包或使用漏洞来注入任何恶意 JavaScript 脚本、HTML 片段或进行 CSRF 攻击。</P>
        <P>3.3 <strong>遵守同人社区规范：</strong> 上传作品至图库时，您必须保证您是作品的原创作者，或者已获得原作者的明确搬运授权。严禁盗图、恶意篡改他人作品或发布与 MLP 无关的内容。</P>
        <H3>4. 内容过滤与安全防爬机制</H3>
        <P>4.1 鉴于数据源包含多种分级内容，本站为遵守国内法律法规及保护未成年人，已在前端默认强制开启并锁定“内容分级过滤器”，自动屏蔽限制级（NSFW）内容。</P>
        <P>4.2 您不得通过技术手段恶意绕过本站的安全过滤机制。</P>
        <P>4.3 <strong>系统安全与防刷限制：</strong> 为防止黑客撞库、批量垃圾注册、爬虫过度拉取造成服务器拥堵，本站全站接口配置了速率限制（Rate Limit）与本地行为轨迹拼图验证。禁止使用任何自动化脚本、按键精灵、多线程工具请求本站。如系统检测到高频请求或异常滑动轨迹，将自动拦截访问并可能对 IP 实施永久封锁。</P>
        <P>4.4 本站保留对您发布在本站内的评论、反馈及上传行为进行审核的权利。如发现违规内容，本站有权在不提前通知的情况下，直接采取删除违规内容、封禁账号、屏蔽该用户 API 访问等措施。</P>
        <H3>5. 知识产权</H3>
        <P>5.1 本站页面设计、前端代码等知识产权归本站开发团队所有，中英翻译词库数据归词库小编团队所有，部分译名参考了 MLP 中文维基和其他网络来源，并同样遵循{' '}
          <OutLink href="https://creativecommons.org/licenses/by-sa/3.0/deed.en">知识共享 署名-相同方式共享 3.0</OutLink>。
        </P>
        <P>5.2 本站展示的画作、图片及相关衍生内容的著作权归属原作者及原发布平台所有。本站不主张对任何通过 API 抓取的图片拥有所有权。</P>
        <P>5.3 您在使用本站时，须尊重原画师的劳动成果。如需转载、商用本站展示的作品，请务必前往原站（Derpibooru）查阅原作者的许可声明，本站无权代表作者授予任何许可。</P>
        <P>
          5.4 桌面小马（Desktop Ponies）功能的素材和部分代码来源于 Desktop Ponies 项目，并严格遵守{' '}
          <OutLink href="https://creativecommons.org/licenses/by-nc-sa/3.0/">知识共享 署名-非商业性使用-相同方式共享 3.0</OutLink>
          ，GitHub 仓库：<OutLink href="https://github.com/RoosterDragon/Desktop-Ponies">RoosterDragon/Desktop-Ponies</OutLink>。
        </P>
        <H3>6. 免责声明</H3>
        <P>6.1 <strong>数据来源免责：</strong> 本站展示的大部分内容由 Derpibooru 平台 API 提供，本站无法对所有抓取内容的合法性、准确性、真实性进行 100% 的实时事前审查。如您发现有漏网的违规图片或侵权内容，请通过“举报”功能联系我们，我们将积极在本地客户端层面进行屏蔽处理，但本站对 Derpibooru 数据源的内容本身不承担法律责任。</P>
        <P>6.2 <strong>服务可用性免责：</strong> 因网络波动、不可抗力、国内外网络连通性问题、或平台（Derpibooru）API 接口限流、熔断、规则调整等原因导致本站服务中断、加载失败或功能异常，本站不承担任何违约或赔偿责任。</P>
        <P>6.3 <strong>数据丢失免责：</strong> 我们会尽力保护您的云端收藏夹、历史记录及 Session 数据安全，但强烈建议您定期自行备份重要数据。因服务器故障或不可抗力导致的数据丢失，本站免责。</P>
        <H3>7. 协议的变更与终止</H3>
        <P>7.1 本站有权根据法律法规变化、网站运营需要或社区规范调整，随时对本协议进行修改。修改后的协议将在网站内公布，公布即生效。</P>
        <P>7.2 如果您不同意修改后的协议，您应立即停止使用本站服务；如果您继续使用，即视为接受修改后的协议。</P>
        <P>7.3 如您严重违反本协议中的任何条款，本站有权随时单方面终止向您提供服务，并永久封停您的账号。</P>
        <H3>8. 其他</H3>
        <P>8.1 本协议的成立、生效、履行、解释及纠纷解决，适用中华人民共和国大陆地区法律。</P>
        <P>8.2 关于本站如何收集和使用您的个人数据，请参阅我们的《PicPony 隐私政策》。</P>
        <P>8.3 如您对本协议有任何疑问，可通过官方交流群（QQ群：1074070030）联系管理团队。</P>
      </div>
    </div>
  );
}

/** PicPony 隐私政策 */
function PrivacyPolicy() {
  return (
    <div>
      <p className="text-body-s text-outline">更新日期：2026年6月</p>
      <div className="mt-3 space-y-3">
        <P>
          欢迎使用 PicPony（中文小马图站）。本隐私政策旨在向您说明在您使用本网站及其相关服务时，我们如何收集、使用、存储和保护您的个人信息。本站作为一个中文镜像客户端，已通过 Derpibooru 授权，数据与功能严格按照 Derpibooru API 文档进行开发与规范化同步。我们高度重视您的隐私，并致力于保护您的个人数据。
        </P>
        <H3>1. 我们收集的信息及用途</H3>
        <UL>
          <li><strong>账号注册与登录信息：</strong> 当您注册账号时，我们会收集您的用户名、密码以及绑定的邮箱地址。邮箱地址主要用于为您发送找回密码验证码，以及密码重置成功的安全系统通知。</li>
          <li><strong>Derpibooru API Key：</strong> 本站允许您绑定 Derpibooru 的 API Key，以便同步您的黑名单过滤、解锁特定内容以及验证真实身份。为保障安全，您的 API Key 在本站服务器数据库中采用强加密算法（对称加密）存储，且在管理员面板等全部界面中进行了脱敏处理（显示为 <Code>abc********rst</Code>）。它仅用于代表您向原站服务器发起数据同步，我们不会在本地进行其他用途的保留。</li>
          <li><strong>本地人机验证滑动轨迹：</strong> 当您在登录、注册或重置密码时拖动滑块人机验证，系统会在您本地浏览器短暂收集拖动轨迹信息（包含每次坐标采样与对应的时间戳偏移量），并使用 XOR 简易算法加密上传。<strong>该轨迹数据仅用于后端即时的生物行为特征防机器脚本检测（计算速度不连贯性及 Y 轴抖动），完成安全判别后即时在内存中销毁，本站绝对不会将轨迹数据写入持久化数据库。</strong></li>
          <li><strong>用户互动数据：</strong> 当您使用云端收藏、发布评论、反馈标签或上传新作品时，相关数据（如图片 ID、评论内容、反馈说明、上传的媒体文件及其标签和描述）将被收集，并提交至本站后台或直接上传至 Derpibooru 原站。评论与反馈在存储前将经过自动 HTML 净化器防注入过滤。</li>
          <li><strong>以图搜图文件：</strong> 当您使用“以图搜图”功能上传本地图片时，图片仅用于发送至服务器进行即时的相似度比对，服务器不会保存您所上传的图片。</li>
          <li><strong>本地偏好与缓存数据：</strong> 我们会将您的部分使用偏好（如内容分级过滤器状态、是否播放视频预览、图片 CDN 加速和 picpony 加速服务器开关、屏蔽或打码的自定义标签组、搜索历史及 API Key 记录等）以 localStorage 的形式直接存储在您的设备浏览器中，不会上传至我们的服务器。此外，会话 Session 数据（以 Cookie <Code>PHPSESSID</Code> 指向）用于存储暂时的 CSRF 校验令牌及限流统计次数。</li>
        </UL>
        <H3>2. 第三方服务与数据交互</H3>
        <P>为了提供完整的找图与社区体验，本站在运行过程中会与以下第三方服务进行数据交互：</P>
        <UL>
          <li><strong>Derpibooru / Trixiebooru：</strong> 本站的核心图片、标签库、评论数据均通过 API 直接来源于 trixiebooru.org。您的搜索请求、API Key 核验以及作品上传行为均会直接与该服务器产生数据交互。</li>
          <li><strong>图片与资源加速服务：</strong> 当您在设置中开启“启用图片 CDN 加速”或“启用 picpony 加速服务器”时，本站会通过加速节点与第三方代理服务（如 <Code>wsrv.nl</Code>）为您拉取并加速资源。</li>
          <li><strong>第三方翻译引擎：</strong> 当您点击评论区的“翻译”按钮时，您的评论原文将被发送至第三方翻译接口（如 Lingva API 或 MyMemory API）以获取中文翻译结果。</li>
        </UL>
        <H3>3. 数据存储与安全</H3>
        <P>我们将采用包括强对称加密、账号哈希算法、XSS 自动净化机制在内的合理安全技术手段，保护您的账号密码、API Token 等敏感数据，防止未经授权的访问、篡改或泄漏。</P>
        <P>鉴于本站大量依赖浏览器的本地存储（localStorage）来保存您的登录凭证（Token）、个人配置及浏览历史，您可以通过浏览器的“清除缓存”功能，或在网站内主动点击“退出登录”、“清除绑定”、“清空搜索历史”来随时销毁这些本地数据并结束 Session。</P>
        <H3>4. 您的权利</H3>
        <UL>
          <li><strong>访问与修改：</strong> 您可以随时在“账户与安全”设置面板中修改您的用户名、密码及上传更新头像。</li>
          <li><strong>解除绑定：</strong> 您可以随时在 API Key 配置面板中点击“清除绑定”，系统将移除您的 API Key 记录并停止后续的数据云端同步。</li>
          <li><strong>数据删除：</strong> 对于您通过 PicPony 本站发布的评论，您拥有随时删除的权限。</li>
        </UL>
        <H3>5. 内容分级与未成年人保护</H3>
        <P>本站严格遵守相关法律法规，已内置“内容分级过滤器”并默认处于“完全安全 (safe)”状态，以自动过滤血腥、暴力及色情等限制级内容。</P>
        <P>针对违规内容，本站提供了快捷的“举报违规内容”功能，用户可随时向管理团队反馈。</P>
        <H3>6. 政策更新与联系方式</H3>
        <P>我们可能会适时对本隐私政策进行修订。如有重大变更，我们将通过系统内的“系统公告”弹窗或消息中心通知您。</P>
        <P>如果您对本政策、网站功能或中英标签词库计划有任何疑问及贡献意向，欢迎加入我们的官方交流群（QQ群：1074070030）与管理团队取得联系。</P>
      </div>
    </div>
  );
}

/** 常见问题（FAQ） */
function Faq() {
  const items: { q: string; a: ReactNode }[] = [
    {
      q: '什么是 PicPony？',
      a: 'PicPony 是一个专注于《我的小马驹》(My Little Pony) 及其同人作品的中文图站。本站作为 Derpibooru (Trixiebooru) 的中文镜像客户端，已通过 Derpibooru 授权，通过 API 实时同步其海量图库，并致力于提供更适合国内用户的中文词库、便捷的浏览方式以及以图搜图等扩展体验。',
    },
    {
      q: '忘记密码怎么办？如何找回密码？',
      a: '我们已在上一次安全升级中，将密码找回流程重构为安全的邮箱验证码两步验证。只要您在注册时绑定了真实有效的邮箱，即可在登录页面点击“找回密码”并输入您的账号或注册邮箱。系统会向您发送一个 6 位数字验证码，输入该验证码及您的新密码即可完成重置。此流程完全独立运行，不再依赖 Derpibooru 的 API Key。',
    },
    {
      q: '绑定 API Key 会泄露隐私吗？安全性如何？',
      a: (
        <>
          绝对安全。本站对所有用户绑定的 API Key 实施了强对称加密算法进行服务端持久化存储。即使是拥有数据库访问权限的系统管理员，在管理后台也只能看到脱敏后的 Key（例如 <Code>abc********rst</Code> 的形式），无法查看到您的完整明文 Key。我们承诺仅将 API Key 用于代表您与原站（Derpibooru）发起数据通信，绝对不会挪作他用。
        </>
      ),
    },
    {
      q: '为什么在滑块人机验证时，总是提示“检测到异常拖动，请重试”？',
      a: (
        <>
          为了防范恶意爬虫和自动化攻击，本站的人机验证系统引入了滑动行为轨迹生物特征分析。系统会检查您滑动的速度连贯性与轨迹偏离度，以下情况会被判定为自动化脚本并拦截：① 滑动轨迹是绝对水平的直线，没有任何垂直方向的微小抖动；② 滑动以完美匀速进行；③ 滑动总时间极短（少于 150 毫秒）或过长（大于 8 秒）。请您在验证时像真人一样自然、连贯地将滑块拖动到指定位置即可。
        </>
      ),
    },
    {
      q: '为什么我的图会出现在这里？',
      a: 'PicPony 是 Derpibooru (Trixiebooru) 的中文镜像站，这些站点是同一个图片库。用户可以在这里汇集来自互联网各处的艺术作品，添加标签和原始来源 URL 以便于搜索，并进行讨论。您的作品之所以出现在这里，是因为有人喜欢它，并将其发布到网站上与社区分享。',
    },
    {
      q: '如何获取 API Key？',
      a: (
        <>
          请您注册并登录 Derpibooru (Trixiebooru)（<OutLink href="https://trixiebooru.org/sessions/new">trixiebooru.org/sessions/new</OutLink>），进入 Account Settings，在页面中找到 API Key 区域的 Click to show 点击查看并复制粘贴到填写 API Key 的区域。
        </>
      ),
    },
    {
      q: '为什么我搜不到某些图片？（提示被拦截或没有结果）',
      a: '本站严格遵守相关法律法规，默认开启“完全安全 (safe)”的内容分级过滤器，包含血腥、暴力、色情等限制级（NSFW）内容的图片将被自动拦截。此外，如果您在设置中开启了“禁止类人生物”或“只看小马”开关，也会过滤掉部分特定类型的画作。',
    },
    {
      q: '为什么搜索框提示“暂时只支持英文 tag”？',
      a: '因为原站的底层数据全部基于英文标签体系进行分类。为了改善中文用户的体验，我们正在积极推进“中英标签词库计划”，不断扩充中文别名。您可以点击标签上的“词库百科”查看翻译。如果您想帮助我们完善词库，欢迎加入我们的官方交流群（QQ群：1074070030）。',
    },
    {
      q: '我在这里上传的新作品会去哪里？',
      a: '当您在绑定了 API Key 的情况下使用“上传新作品”功能时，您的图片及填写的标签、描述将通过 API 直接提交至 Derpibooru (Trixiebooru)。请注意：请务必遵守原站的上传规范和版权要求，不要上传未经原作者允许的画作或与 MLP 毫无关联的内容。',
    },
    {
      q: '图片加载很慢怎么办？',
      a: '由于原站服务器位于海外，国内直连可能存在网络波动。您可以在设置菜单中尝试开启“启用图片 CDN 加速”和“启用 picpony 加速”选项。开启后，本站将通过加速节点为您拉取资源，通常能显著提升加载速度。',
    },
    {
      q: '我该如何举报违规内容？',
      a: '本站无法直接删除原站的图库数据。如果您发现某张图片或某条评论包含严重的违规内容，请点击图片详情页底部的“举报此图或违规评论”按钮。我们的管理团队会跟进并在 PicPony 站点内进行屏蔽处理。如果您觉得图片同样违反 Derpibooru (Trixiebooru) 规定，请前往原站举报。',
    },
    {
      q: '如何删除我已经上传的图片？',
      a: '根据 Derpibooru (Trixiebooru) 的规定，即使是上传者一般也不可以删除，只有经过认定的原画师/艺术家才能申请下架图片。如果您的图片带有 artist: 标签，您需要找到该 artist 标签对应的认证 Derpibooru 账号去申请删除此图片。',
    },
    {
      q: '如何认证画师/艺术家标签？',
      a: '首先您需要拥有 Derpibooru 账号，登录后访问 trixiebooru.org 进行认证。',
    },
    {
      q: '我是画师/艺术家，我发现我的作品未经允许被上传了',
      a: (
        <>
          请您访问 Derpibooru 原帖页面（PicPony 图片详情中通常有指向原帖的按钮），在原帖页面中点击 Report（举报），选择一般举报，然后选择 Takedown request（请求下架），并在输入框内填写：“I am the artist of this image, and I want to take it down.”。请注意前提条件：您的 Derpibooru 账号是该图 artist: 标签的认证账号。
        </>
      ),
    },
    {
      q: '我是这张图的原画师，但这张图的艺术家标签并不是我',
      a: '请您访问 Derpibooru 原帖页面，在原帖页面中点击 Tags 后的 Edit 按钮来修改错误的标签。',
    },
    {
      q: '我不想我的 OC 图上传到本站中',
      a: '根据版权法，委托创作（约稿）图像的所有权归创作该图像的艺术家所有，而非委托人（买断除外）。只有创作该图像的艺术家才有权要求删除该图像。如果上传者是原画师/艺术家，建议您与画师沟通；如果上传者不是原画师/艺术家，请联系原画师前往 Derpibooru 认证画师标签并申请下架。',
    },
    {
      q: '我是原画师，在申请下架后上传者依旧在上传我的图片该怎么办？',
      a: (
        <>
          经过画师认证后请访问 <OutLink href="https://trixiebooru.org/dnp/new">trixiebooru.org/dnp/new</OutLink>，将自己的画师标签设置为仅自己发布即可。
        </>
      ),
    },
  ];

  return (
    <dl className="space-y-5">
      {items.map((item, i) => (
        <div key={i}>
          <dt className="text-title-s text-on-surface">
            Q: {item.q}
          </dt>
          <dd className="mt-1 text-body-m leading-relaxed text-on-surface-variant">A: {item.a}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function PolicyPage() {
  const [active, setActive] = useState<PolicyKey>('cookie');

  return (
    <div className="mx-auto max-w-4xl animate-fade-in px-4 py-8">
      <h1 className="mb-6 text-headline-s text-on-surface">声明与政策</h1>

      {/* 板块切换，样式与消息/通知页一致 */}
      <TabBar
        tabs={TABS}
        value={active}
        onChange={setActive}
        label="声明与政策"
        className="mb-6"
      />

      <Card variant="filled" padding="lg">
        {active === 'cookie' && <CookiePolicy />}
        {active === 'agreement' && <AgreementPolicy />}
        {active === 'privacy' && <PrivacyPolicy />}
        {active === 'faq' && <Faq />}
      </Card>
    </div>
  );
}
