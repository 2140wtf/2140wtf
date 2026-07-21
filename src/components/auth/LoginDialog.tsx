// NOTE: This file is stable and usually should not be modified.
// It is important that all functionality in this file is preserved, and should only be modified if explicitly requested.

import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  Upload,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Loader2,
  ExternalLink,
  Newspaper,
  KeyRound,
  Fingerprint,
  Zap,
  ArrowRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { QRCodeCanvas } from '@/components/ui/qrcode';
import {
  useLoginActions,
  generateNostrConnectParams,
  generateNostrConnectURI,
  type NostrConnectParams,
  type NostrConnectStatus,
} from '@/hooks/useLoginActions';
import { getNsecCredential } from '@/lib/credentialManager';
import { DialogTitle } from '@radix-ui/react-dialog';
import { useAppContext } from '@/hooks/useAppContext';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useShareOrigin } from '@/hooks/useShareOrigin';
import {
  registerNativePasskeyAccount,
  loginNativePasskeyAccount,
  getNativePasskeyAvailability,
  type NativePasskeyAvailability,
} from '@/lib/nativePasskeyAuth';

interface LoginDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onLogin: () => void;
  onSignupClick?: () => void;
}

const validateNsec = (nsec: string) => {
  return /^nsec1[a-zA-Z0-9]{58}$/.test(nsec);
};

const validateBunkerUri = (uri: string) => {
  return uri.startsWith('bunker://');
};

const connectStatusLabel = (status: NostrConnectStatus | null): string => {
  switch (status) {
    case 'awaiting-connect':
      return 'Waiting for signer connection…';
    case 'getting-public-key':
      return 'Getting public key…';
    default:
      return '';
  }
};

const LoginDialog: React.FC<LoginDialogProps> = ({ isOpen, onClose, onLogin, onSignupClick }) => {
  const { config } = useAppContext();
  const shareOrigin = useShareOrigin();
  const [isLoading, setIsLoading] = useState(false);
  const [isFileLoading, setIsFileLoading] = useState(false);
  const [nsec, setNsec] = useState('');
  const [bunkerUri, setBunkerUri] = useState('');
  const [nostrConnectParams, setNostrConnectParams] = useState<NostrConnectParams | null>(null);
  const [nostrConnectUri, setNostrConnectUri] = useState<string>('');
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connectStatus, setConnectStatus] = useState<NostrConnectStatus | null>(null);
  const [hasOpenedSigner, setHasOpenedSigner] = useState(false);
  const [showBunkerInput, setShowBunkerInput] = useState(false);
  const [errors, setErrors] = useState<{
    nsec?: string;
    bunker?: string;
    file?: string;
    extension?: string;
    passkey?: string;
  }>({});
  const [activeTab, setActiveTab] = useState('secret');
  const [passkeyAvail, setPasskeyAvail] = useState<NativePasskeyAvailability | null>(null);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const login = useLoginActions();

  const onLoginRef = useRef(onLogin);
  const onCloseRef = useRef(onClose);
  const loginRef = useRef(login);
  useEffect(() => { onLoginRef.current = onLogin; }, [onLogin]);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => { loginRef.current = login; }, [login]);

  const isMobile = useIsMobile();
  const hasExtension = 'nostr' in window;
  const hasWebLN = typeof window !== 'undefined' && 'webln' in window;

  const generateConnectSession = useCallback(() => {
    const relayUrls = login.getRelayUrls();
    const params = generateNostrConnectParams(relayUrls);
    const isMobileDevice = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const uri = generateNostrConnectURI(params, {
      name: config.appName,
      callback: isMobileDevice ? `${shareOrigin}/remoteloginsuccess` : undefined,
    });
    setNostrConnectParams(params);
    setNostrConnectUri(uri);
    setConnectError(null);
  }, [login, config.appName, shareOrigin]);

  useEffect(() => {
    if (!nostrConnectParams) return;

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const startListening = async () => {
      try {
        await loginRef.current.nostrconnect(
          nostrConnectParams,
          controller.signal,
          (status) => {
            if (controller.signal.aborted) return;
            setConnectStatus(status);
          },
        );
        if (controller.signal.aborted) return;
        onLoginRef.current();
        onCloseRef.current();
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
        if (controller.signal.aborted) return;
        console.error('Nostrconnect failed:', error);
        setConnectStatus(null);
        setConnectError(error instanceof Error ? error.message : String(error));
      }
    };

    startListening();

    return () => {
      controller.abort();
    };
  }, [nostrConnectParams]);

  useEffect(() => {
    if (!isOpen) {
      setNostrConnectParams(null);
      setNostrConnectUri('');
      setConnectError(null);
      setConnectStatus(null);
      setHasOpenedSigner(false);
      setActiveTab('secret');
      setErrors({});
    }
  }, [isOpen]);

  const handleRetry = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setNostrConnectParams(null);
    setNostrConnectUri('');
    setConnectError(null);
    setConnectStatus(null);
    setHasOpenedSigner(false);
    setTimeout(() => generateConnectSession(), 0);
  }, [generateConnectSession]);

  const handleOpenSignerApp = () => {
    if (!nostrConnectUri) return;
    setHasOpenedSigner(true);
    window.location.href = nostrConnectUri;
  };

  const handleExtensionLogin = async () => {
    setIsLoading(true);
    setErrors(prev => ({ ...prev, extension: undefined }));

    try {
      if (!('nostr' in window)) {
        throw new Error('Nostr extension not found. Please install a NIP-07 extension.');
      }
      await login.extension();
      onLogin();
      onClose();
    } catch (e: unknown) {
      const error = e as Error;
      console.error('Extension login failed:', error);
      setErrors(prev => ({
        ...prev,
        extension: error instanceof Error ? error.message : 'Extension login failed'
      }));
    } finally {
      setIsLoading(false);
    }
  };

  const executeLogin = (key: string) => {
    setIsLoading(true);
    setErrors({});

    setTimeout(() => {
      try {
        login.nsec(key);
        onLogin();
        onClose();
      } catch {
        setErrors({ nsec: "Failed to login with this key. Please check that it's correct." });
        setIsLoading(false);
      }
    }, 50);
  };

  const handleKeyLogin = () => {
    if (!nsec.trim()) {
      setErrors(prev => ({ ...prev, nsec: 'Please enter your secret key' }));
      return;
    }

    if (!validateNsec(nsec)) {
      setErrors(prev => ({ ...prev, nsec: 'Invalid secret key format. Must be a valid nsec starting with nsec1.' }));
      return;
    }
    executeLogin(nsec);
  };

  const handleBunkerLogin = async () => {
    if (!bunkerUri.trim()) {
      setErrors(prev => ({ ...prev, bunker: 'Please enter a bunker URI' }));
      return;
    }

    if (!validateBunkerUri(bunkerUri)) {
      setErrors(prev => ({ ...prev, bunker: 'Invalid bunker URI format. Must start with bunker://' }));
      return;
    }

    setIsLoading(true);
    setErrors(prev => ({ ...prev, bunker: undefined }));

    try {
      await login.bunker(bunkerUri);
      onLogin();
      onClose();
      setBunkerUri('');
    } catch {
      setErrors(prev => ({
        ...prev,
        bunker: 'Failed to connect to bunker. Please check the URI.'
      }));
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsFileLoading(true);
    setErrors({});

    const reader = new FileReader();
    reader.onload = (event) => {
      setIsFileLoading(false);
      const content = event.target?.result as string;
      if (content) {
        const trimmedContent = content.trim();
        if (validateNsec(trimmedContent)) {
          executeLogin(trimmedContent);
        } else {
          setErrors({ file: 'File does not contain a valid secret key.' });
        }
      } else {
        setErrors({ file: 'Could not read file content.' });
      }
    };
    reader.onerror = () => {
      setIsFileLoading(false);
      setErrors({ file: 'Failed to read file.' });
    };
    reader.readAsText(file);
  };

  const refreshPasskeyAvailability = useCallback(async () => {
    try {
      const avail = await getNativePasskeyAvailability();
      setPasskeyAvail(avail);
    } catch {
      setPasskeyAvail({ available: false, prf: false, largeBlob: false, enrolled: false });
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    refreshPasskeyAvailability();
  }, [isOpen, refreshPasskeyAvailability]);

  const handlePasskeyRegister = async () => {
    setPasskeyLoading(true);
    setErrors(prev => ({ ...prev, passkey: undefined }));
    try {
      const result = await registerNativePasskeyAccount();
      login.nsec(result.identity.nsec);
      onLogin();
      onClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Passkey setup failed';
      setErrors(prev => ({ ...prev, passkey: msg }));
      setPasskeyLoading(false);
    }
  };

  const handlePasskeyLogin = async () => {
    setPasskeyLoading(true);
    setErrors(prev => ({ ...prev, passkey: undefined }));
    try {
      const identity = await loginNativePasskeyAccount();
      login.nsec(identity.nsec);
      onLogin();
      onClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Passkey login failed';
      setErrors(prev => ({ ...prev, passkey: msg }));
      setPasskeyLoading(false);
    }
  };

  const handleOpenWebLN = async () => {
    try {
      const webln = (window as unknown as { webln?: { enable?: () => Promise<unknown> } }).webln;
      await webln?.enable?.();
    } catch {
      // ignore
    }
  };

  // Progressive enhancement: attempt to retrieve a stored credential from the
  // platform's password manager when the dialog opens.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    getNsecCredential().then((cred) => {
      if (cancelled || !cred) return;
      if (validateNsec(cred.nsec)) {
        executeLogin(cred.nsec);
      }
    }).catch(() => {
      // Credential retrieval is best-effort; ignore failures.
    });

    return () => { cancelled = true; };
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const showProgressView = connectStatus !== null && (
    connectStatus === 'getting-public-key' ||
    (isMobile && hasOpenedSigner)
  );

  const renderTabs = () => (
    <Tabs
      value={activeTab}
      onValueChange={(value) => {
        setActiveTab(value);
        if (value === 'remote' && !nostrConnectParams && !connectError) {
          generateConnectSession();
        }
        if (value === 'passkey') {
          refreshPasskeyAvailability();
        }
      }}
      className="w-full"
    >
      <TabsList className="grid w-full grid-cols-4 bg-muted border rounded-none mb-4 h-auto">
        <TabsTrigger value="secret" className="flex flex-col sm:flex-row items-center gap-1 rounded-none py-2 px-1 text-[10px] sm:text-xs">
          <KeyRound className="size-3.5 sm:size-4" />
          <span>Key</span>
        </TabsTrigger>
        <TabsTrigger value="remote" className="flex flex-col sm:flex-row items-center gap-1 rounded-none py-2 px-1 text-[10px] sm:text-xs">
          <ExternalLink className="size-3.5 sm:size-4" />
          <span>Remote</span>
        </TabsTrigger>
        <TabsTrigger value="passkey" className="flex flex-col sm:flex-row items-center gap-1 rounded-none py-2 px-1 text-[10px] sm:text-xs">
          <Fingerprint className="size-3.5 sm:size-4" />
          <span>Passkey</span>
        </TabsTrigger>
        <TabsTrigger value="lightning" className="flex flex-col sm:flex-row items-center gap-1 rounded-none py-2 px-1 text-[10px] sm:text-xs">
          <Zap className="size-3.5 sm:size-4" />
          <span>LN</span>
        </TabsTrigger>
      </TabsList>

      <TabsContent value='secret' className='space-y-4'>
        <form onSubmit={(e) => {
          e.preventDefault();
          handleKeyLogin();
        }} className='space-y-4'>
          <div className='space-y-2'>
            <Input
              id='nsec'
              type="password"
              value={nsec}
              onChange={(e) => {
                setNsec(e.target.value);
                if (errors.nsec) setErrors(prev => ({ ...prev, nsec: undefined }));
              }}
              className={`rounded-none ${
                errors.nsec ? 'border-red-500 focus-visible:ring-red-500' : ''
              }`}
              placeholder='nsec1...'
              autoComplete="off"
            />
            {errors.nsec && (
              <p className="text-sm text-red-500">{errors.nsec}</p>
            )}
          </div>

          <div className="flex space-x-2">
            <Button
              type="submit"
              size="lg"
              disabled={isLoading || !nsec.trim()}
              className="flex-1 rounded-none"
            >
              {isLoading ? 'Verifying...' : 'Log in'}
            </Button>

            <input
              type="file"
              accept=".txt"
              className="hidden"
              ref={fileInputRef}
              onChange={handleFileUpload}
            />
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading || isFileLoading}
              className="px-3 rounded-none"
            >
              <Upload className="w-4 h-4" />
            </Button>
          </div>

          {errors.file && (
            <p className="text-sm text-red-500 text-center">{errors.file}</p>
          )}
        </form>
      </TabsContent>

      <TabsContent value='remote' className='space-y-4'>
        <div className='flex flex-col items-center space-y-4'>
          {connectError ? (
            <div className='flex flex-col items-center space-y-4 py-4'>
              <p className='text-sm text-red-500 text-center'>{connectError}</p>
              <Button variant='outline' className='rounded-none' onClick={handleRetry}>
                Retry
              </Button>
            </div>
          ) : showProgressView ? (
            <div className='flex flex-col items-center space-y-4 py-6 w-full'>
              <Loader2 className='w-8 h-8 animate-spin text-primary' />
              <p className='text-sm text-muted-foreground text-center min-h-[1.25rem]'>
                {connectStatusLabel(connectStatus)}
              </p>
              <button
                type='button'
                onClick={handleRetry}
                className='text-sm text-primary hover:underline underline-offset-4 font-medium'
              >
                Cancel
              </button>
            </div>
          ) : nostrConnectUri ? (
            <>
              {!isMobile && (
                <div className='p-4 bg-card border rounded-none'>
                  <QRCodeCanvas
                    value={nostrConnectUri}
                    size={180}
                    level='M'
                  />
                </div>
              )}

              {isMobile && (
                <Button
                  className='w-full gap-2 py-6 rounded-none'
                  onClick={handleOpenSignerApp}
                >
                  <ExternalLink className='w-5 h-5' />
                  Open Signer App
                </Button>
              )}
            </>
          ) : (
            <div className='flex items-center justify-center h-[100px]'>
              <Loader2 className='w-8 h-8 animate-spin text-muted-foreground' />
            </div>
          )}
        </div>

        <div className='pt-4 border-t border-border'>
          <button
            type='button'
            onClick={() => setShowBunkerInput(!showBunkerInput)}
            className='flex items-center justify-center gap-2 w-full text-sm text-muted-foreground hover:text-foreground transition-colors py-2'
          >
            <span>Enter bunker URI manually</span>
            {showBunkerInput ? (
              <ChevronUp className='w-4 h-4' />
            ) : (
              <ChevronDown className='w-4 h-4' />
            )}
          </button>

          {showBunkerInput && (
            <div className='space-y-3 mt-3'>
              <div className='space-y-2'>
                <Input
                  id='connectBunkerUri'
                  value={bunkerUri}
                  onChange={(e) => setBunkerUri(e.target.value)}
                  className='rounded-none border-input focus-visible:ring-primary text-base md:text-sm'
                  placeholder='bunker://'
                />
                {bunkerUri && !validateBunkerUri(bunkerUri) && (
                  <p className='text-red-500 text-xs'>Invalid bunker URI format</p>
                )}
              </div>

              <Button
                className='w-full rounded-none py-4'
                variant='outline'
                onClick={handleBunkerLogin}
                disabled={isLoading || !bunkerUri.trim() || !validateBunkerUri(bunkerUri)}
              >
                {isLoading ? 'Connecting...' : 'Connect'}
              </Button>
            </div>
          )}
        </div>
      </TabsContent>

      <TabsContent value='passkey' className='space-y-4'>
        <div className='text-center space-y-4'>
          <div className="flex size-16 text-3xl bg-primary/10 rounded-full items-center justify-center justify-self-center">
            <Fingerprint className="size-7 text-primary" />
          </div>
          <p className="text-sm text-muted-foreground">
            Use your device&apos;s biometric authenticator (Touch ID, Face ID, Windows Hello, YubiKey) to create or unlock a Nostr account.
          </p>
          {errors.passkey && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{errors.passkey}</AlertDescription>
            </Alert>
          )}
          {!passkeyAvail ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : !passkeyAvail.available ? (
            <p className="text-sm text-muted-foreground">
              Passkeys are not available on this browser. Try a modern browser or device with biometric authentication.
            </p>
          ) : (
            <div className="space-y-3">
              {passkeyAvail.enrolled ? (
                <Button
                  className="w-full h-12 rounded-none"
                  onClick={handlePasskeyLogin}
                  disabled={passkeyLoading}
                >
                  {passkeyLoading ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Unlocking…</>
                  ) : (
                    <><Fingerprint className="w-4 h-4 mr-2" /> Sign in with Passkey</>
                  )}
                </Button>
              ) : (
                <Button
                  className="w-full h-12 rounded-none"
                  onClick={handlePasskeyRegister}
                  disabled={passkeyLoading}
                >
                  {passkeyLoading ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Setting up…</>
                  ) : (
                    <><Fingerprint className="w-4 h-4 mr-2" /> Create Passkey Account</>
                  )}
                </Button>
              )}
            </div>
          )}
        </div>
      </TabsContent>

      <TabsContent value='lightning' className='space-y-4'>
        <div className='text-center space-y-4'>
          <div className="flex size-16 text-3xl bg-primary/10 rounded-full items-center justify-center justify-self-center">
            <Zap className="size-7 text-primary" />
          </div>
          <p className="text-sm text-muted-foreground">
            Lightning wallet login (LNURL-auth) is coming soon. For now, use a Lightning wallet that also provides a Nostr extension, such as Alby.
          </p>
          {hasWebLN && (
            <Button
              variant="outline"
              className="w-full h-12 rounded-none"
              onClick={handleOpenWebLN}
            >
              <Zap className="w-4 h-4 mr-2" /> Open Lightning Wallet
            </Button>
          )}
          {!hasExtension && (
            <p className="text-xs text-muted-foreground">
              No Nostr extension detected. Install Alby or another NIP-07 extension to log in with Lightning.
            </p>
          )}
        </div>
      </TabsContent>
    </Tabs>
  );

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-[95vw] sm:max-w-sm max-h-[90dvh] p-0 gap-6 overflow-hidden rounded-none border-2 border-foreground/20 overflow-y-auto shadow-2xl">
        <DialogHeader className="px-6 pt-6">
          <div className="flex items-center justify-center gap-2 text-primary">
            <Newspaper className="w-6 h-6" />
            <span className="text-xs uppercase tracking-widest font-medium">The Daily Nostr</span>
          </div>
          <DialogTitle
            className="text-center mt-2"
            style={{ fontFamily: 'var(--title-font-family, serif)' }}
          >
            <img
              src="/logo.png"
              alt="2140.wtf"
              className="h-12 w-auto mx-auto"
            />
          </DialogTitle>
        </DialogHeader>

        <div className='px-6 pb-6 space-y-4 overflow-y-auto'>
          {onSignupClick && (
            <Button
              type="button"
              variant="outline"
              className="w-full h-12 rounded-none"
              onClick={() => { onClose(); onSignupClick(); }}
            >
              <ArrowRight className="w-4 h-4 mr-2" />
              Create account
            </Button>
          )}

          {hasExtension && (
            <div className="space-y-3">
              {errors.extension && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>{errors.extension}</AlertDescription>
                </Alert>
              )}
              <Button
                className="w-full h-12 px-9 rounded-none"
                onClick={handleExtensionLogin}
                disabled={isLoading}
              >
                {isLoading ? 'Logging in...' : 'Log in with Extension'}
              </Button>
            </div>
          )}

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">or</span>
            </div>
          </div>

          {renderTabs()}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default LoginDialog;
