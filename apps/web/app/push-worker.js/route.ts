export function GET() {
  return new Response(
    `self.addEventListener('push',event=>{event.waitUntil((async()=>{const data=event.data?.json();if(!data||!data.id)return;const existing=await self.registration.getNotifications({tag:data.id});if(existing.length)return;await self.registration.showNotification(data.title,{body:data.body,tag:data.id,renotify:false,data:{url:data.url}});})());});self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil((async()=>{const url=event.notification.data?.url;if(typeof url!=='string')return;const parsed=new URL(url,self.location.origin);if(parsed.protocol!=='https:'&&parsed.origin!==self.location.origin)return;await clients.openWindow(parsed.href);})());});`,
    {
      headers: {
        "Content-Type": "application/javascript",
        "Cache-Control": "no-cache",
        "Service-Worker-Allowed": "/",
      },
    },
  );
}
