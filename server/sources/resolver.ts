import { NapClient } from './nap';
import type { ResolvedSource, SourceDescriptor, SourceResolver, SourceSupplier } from './types';
export class DefaultSourceResolver implements SourceResolver {
  constructor(private readonly nap = new NapClient()) {}
  async resolve(source: SourceDescriptor): Promise<ResolvedSource> { return source.type === 'nap' ? this.nap.resolve(source) : { url: source.url, identity: `http:${source.url}`, temporary: false }; }
}
export const sourceSupplier = (source: SourceDescriptor, resolver: SourceResolver = new DefaultSourceResolver()): SourceSupplier => () => resolver.resolve(source);
