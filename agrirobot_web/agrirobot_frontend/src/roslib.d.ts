declare module 'roslib' {
  export class Ros {
    constructor(options: { url: string });
    on(event: 'connection', callback: () => void): void;
    on(event: 'error', callback: (error: Error) => void): void;
    on(event: 'close', callback: () => void): void;
    close(): void;
  }

  export class Topic {
    constructor(options: {
      ros: Ros;
      name: string;
      messageType: string;
    });
    subscribe(callback: (message: any) => void): void;
    unsubscribe(): void;
    publish(message: Message): void;
  }

  export class Message {
    constructor(data: Record<string, any>);
  }

  export class Service {
    constructor(options: {
      ros: Ros;
      name: string;
      serviceType: string;
    });
    callService(
      request: any,
      callback: (response: any) => void,
      errorCallback?: (error: Error) => void
    ): void;
  }

  export class Param {
    constructor(options: { ros: Ros; name: string });
    get(callback: (value: any) => void): void;
    set(value: any, callback: () => void): void;
  }
}
